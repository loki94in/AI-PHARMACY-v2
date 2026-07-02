# AI Camera Image Testing Design

## Purpose
Create a simple testing mechanism for the user to evaluate the AI Camera OCR feature with their own medicine label images, showing raw OCR text and confidence scores.

## Components
1. **Test Images Folder**: `test-images/` in project root for user to place images
2. **Testing Script**: `test-ai-camera-images.mjs` that processes all images in the folder
3. **Output Format**: Raw OCR text + confidence percentage + processing time per image

## Data Flow
1. User places JPEG/PNG images in `test-images/` folder
2. Testing script initializes AI Camera service
3. For each image:
   - Read image file and convert to base64
   - Process with `aiCameraService.processImage()`
   - Extract raw text and confidence from result
   - Measure processing time
   - Display results
4. Service cleanup after all images processed

## Error Handling
- Skip non-image files
- Graceful handling of corrupt/unreadable images
- Service initialization errors reported clearly
- Individual image failures don't stop batch processing

## Success Criteria
- User can place images in designated folder
- Script runs successfully showing OCR results for each image
- Output includes: filename, OCR text, confidence %, processing time
- No server/API dependencies - direct service usage

## Implementation Notes
- Use existing `aiCameraService` from `src/services/aiCameraService.ts`
- Support common image formats: JPG, JPEG, PNG
- Process images sequentially to avoid resource conflicts
- Show total processing time for all images