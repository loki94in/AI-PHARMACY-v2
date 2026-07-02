import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

async function killOrphanChromeProcesses(keyword: string): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    const { stdout } = await execAsync(`wmic process where "name='chrome.exe' and CommandLine like '%${keyword}%'" get ProcessId`);
    const pids = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.toLowerCase().includes('processid'))
      .map(pid => parseInt(pid, 10))
      .filter(pid => !isNaN(pid));

    for (const pid of pids) {
      console.log(`[ProcessGuardian] Killing lock-holding Chrome process: ${pid}`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err) {
        try {
          await execAsync(`taskkill /F /PID ${pid}`);
        } catch (_) {}
      }
    }
    if (pids.length > 0) {
      console.log('Waiting 1 second for process cleanup...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (err: any) {
    console.error(`[ProcessGuardian] Failed to kill lock-holding Chrome processes for ${keyword}:`, err.message);
  }
}

export function cleanProfileLockFiles(profilePath: string) {
  if (!fs.existsSync(profilePath)) return;
  const lockFiles = [
    'SingletonLock',
    'lockfile',
    'parent.lock',
    'Singleton Cookie',
    'Singleton Socket',
    'Singleton Preference',
    'devtoolsactiveport'
  ];
  for (const file of lockFiles) {
    const filePath = path.join(profilePath, file);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`Removed stale lock file: ${filePath}`);
      } catch (err: any) {
        console.warn(`Could not remove lock file ${filePath}: ${err.message}`);
      }
    }
  }
}

async function testLaunch() {
  const chromePath = findChromePath();
  console.log('Found Chrome path:', chromePath);
  if (!chromePath) {
    console.error('Google Chrome was not found!');
    return;
  }

  const pharmarackProfilePath = path.resolve(__dirname, '..', 'data', 'pharmarack_profile');
  console.log('Profile path:', pharmarackProfilePath);

  // Kill lock-holding processes first
  await killOrphanChromeProcesses('pharmarack_profile');
  cleanProfileLockFiles(pharmarackProfilePath);

  try {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      defaultViewport: null,
      userDataDir: pharmarackProfilePath,
      args: ['--start-maximized']
    });

    console.log('Browser launched successfully!');
    const [page] = await browser.pages();
    console.log('Navigating to login page...');
    await page.goto('https://retailers.pharmarack.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Navigation successful!');
    
    console.log('Waiting 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
    await browser.close();
    console.log('Browser closed.');
  } catch (err) {
    console.error('Error during launch:', err);
  }
}

testLaunch();
