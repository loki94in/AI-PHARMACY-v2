import { PaddleOcrService } from 'paddleocr';
import * as ort from 'onnxruntime-node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';

// Resolve paths relative to THIS file, not CWD — fixes flake in Jest / different launch dirs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODELS_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'models');

class OnnxOcrService {
  private ocrService: PaddleOcrService | null = null;
  private isLoaded: boolean = false;
  private readonly detPath = path.join(MODELS_DIR, 'det_model.onnx');
  private readonly recPath = path.join(MODELS_DIR, 'rec_model.onnx');
  private readonly clsPath = path.join(MODELS_DIR, 'cls_model.onnx');
  private readonly dictPath = path.join(MODELS_DIR, 'en_dict.txt');
  private idleTimeout: NodeJS.Timeout | null = null;
  private readonly IDLE_TIME_MS = 105 * 60 * 1000; // 1 hour 45 minutes (105 minutes) as per pharmacy requirements

  /**
   * Lazy load the models into the ONNX session
   */
  public async loadModel(): Promise<void> {
    if (this.isLoaded) {
      this.resetIdleTimeout();
      return;
    }

    try {
      if (!fs.existsSync(this.detPath) || !fs.existsSync(this.recPath) || !fs.existsSync(this.dictPath)) {
        throw new Error('Required ONNX models or dictionary file are missing in data/models/');
      }

      console.log('[ONNX OCR] Reading model buffers from disk...');
      const detBuffer = fs.readFileSync(this.detPath).buffer;
      const recBuffer = fs.readFileSync(this.recPath).buffer;
      const dict = fs.readFileSync(this.dictPath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.replace('\r', ''));

      const config: any = {
        ort,
        detection: {
          modelBuffer: detBuffer,
          maxSideLength: 720 // Reduce input side length to limit RAM and CPU load
        },
        recognition: {
          modelBuffer: recBuffer,
          charactersDictionary: dict
        }
      };

      // Load optional direction classifier model if present
      if (fs.existsSync(this.clsPath)) {
        console.log('[ONNX OCR] Found optional direction classifier model.');
        config.classifier = {
          modelBuffer: fs.readFileSync(this.clsPath).buffer
        };
      }

      console.log('[ONNX OCR] Creating InferenceSession instance...');
      this.ocrService = await PaddleOcrService.createInstance(config);
      this.isLoaded = true;
      console.log('[ONNX OCR] Native models loaded successfully.');
      this.resetIdleTimeout();
    } catch (error) {
      console.error('[ONNX OCR] Failed to load ONNX models:', error);
      this.isLoaded = false;
      this.ocrService = null;
      throw error;
    }
  }

  /**
   * Reset the idle timer to unload models when not in use
   */
  private resetIdleTimeout(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }
    this.idleTimeout = setTimeout(() => {
      console.log('[ONNX OCR] Idle timeout reached. Unloading models to free memory.');
      this.unloadModel().catch(err => console.error('[ONNX OCR] Error unloading models:', err));
    }, this.IDLE_TIME_MS);
  }

  /**
   * Unload models from RAM
   */
  public async unloadModel(): Promise<void> {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
    if (this.ocrService) {
      await this.ocrService.destroy();
      this.ocrService = null;
    }
    this.isLoaded = false;
    // Suggest garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Checks if models are available on disk
   */
  public async checkAvailability(): Promise<boolean> {
    return fs.existsSync(this.detPath) && fs.existsSync(this.recPath) && fs.existsSync(this.dictPath);
  }

  /**
   * Scan image and extract text regions
   * @param imageData Base64 string, filepath string, or Buffer
   */
  public async scanImage(imageData: string | Buffer): Promise<any> {
    await this.loadModel();
    if (!this.ocrService) {
      throw new Error('OCR service failed to initialize.');
    }

    this.resetIdleTimeout();

    try {
      let buffer: Buffer;
      if (typeof imageData === 'string') {
        if (imageData.startsWith('data:')) {
          const base64Data = imageData.split(',')[1];
          buffer = Buffer.from(base64Data, 'base64');
        } else if (fs.existsSync(imageData)) {
          buffer = fs.readFileSync(imageData);
        } else {
          buffer = Buffer.from(imageData, 'base64');
        }
      } else {
        buffer = imageData;
      }

      // Preprocess image with Jimp: downscale to maximum of 720px side length to minimize memory
      const image = await Jimp.read(buffer);
      if (image.width > 720 || image.height > 720) {
        image.resize({ w: 720 });
      }

      const input = {
        data: new Uint8Array(image.bitmap.data),
        width: image.bitmap.width,
        height: image.bitmap.height
      };

      const recognitionResult = await this.ocrService.recognize(input);
      const formatted = this.ocrService.processRecognition(recognitionResult);

      const words = recognitionResult.map(item => ({
        text: item.text,
        confidence: Math.round(item.confidence * 100),
        bbox: {
          x0: item.box.x,
          y0: item.box.y,
          x1: item.box.x + item.box.width,
          y1: item.box.y + item.box.height
        }
      }));

      return {
        success: true,
        text: formatted.text || '',
        confidence: Math.round(formatted.confidence * 100),
        words: words
      };
    } catch (error: any) {
      console.error('[ONNX OCR] Error processing scan image:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export const onnxOcrService = new OnnxOcrService();
export default onnxOcrService;
