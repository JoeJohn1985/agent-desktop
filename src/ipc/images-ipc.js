// ── Images IPC Handlers ────────────────────────────────────────
// Extracted from main.js — image gallery and video frame extraction IPC
'use strict';

const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

function registerImagesIPC({ IMAGES_DIR, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, sendToRenderer }) {

  const VIDEO_FRAMES_DIR = path.join(IMAGES_DIR, '_frames');

  ipcMain.handle('images:list', async () => {
    try {
      if (!fs.existsSync(IMAGES_DIR)) return [];
      const files = fs.readdirSync(IMAGES_DIR);
      return files
        .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()) || VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()))
        .map(f => {
          const fullPath = path.join(IMAGES_DIR, f);
          const stat = fs.statSync(fullPath);
          const ext = path.extname(f).toLowerCase();
          return {
            name: f,
            path: fullPath,
            size: stat.size,
            mtime: stat.mtimeMs,
            type: VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image',
          };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch (e) {
      console.warn('[images:list] Fehler:', e.message || e);
      return [];
    }
  });

  ipcMain.handle('images:open', async (_event, filePath) => {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(IMAGES_DIR + path.sep) && resolved !== IMAGES_DIR) return;
    shell.openPath(resolved);
  });

  ipcMain.handle('images:delete', async (_event, filePath) => {
    try {
      const resolved = path.resolve(filePath);
      if (fs.existsSync(resolved) && resolved.startsWith(IMAGES_DIR + path.sep)) {
        fs.unlinkSync(resolved);
      }
    } catch (e) {
      console.warn('[images:delete] Fehler:', e.message || e);
    }
  });

  ipcMain.handle('images:openFolder', async () => {
    shell.openPath(IMAGES_DIR);
  });

  ipcMain.handle('videos:extractFrames', async (_event, videoPath, options = {}) => {
    if (typeof videoPath !== 'string') return { success: false, error: 'Ungültiger Pfad' };
    const resolved = path.resolve(videoPath);
    if (!fs.existsSync(resolved)) return { success: false, error: 'Datei nicht gefunden' };

    const videoName = path.basename(resolved, path.extname(resolved));
    const outDir = path.join(VIDEO_FRAMES_DIR, videoName);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const existing = fs.readdirSync(outDir).filter(f => f.endsWith('.png'));
    if (existing.length > 0 && !options.force) {
      return {
        success: true,
        cached: true,
        framesDir: outDir,
        frames: existing.sort().map(f => path.join(outDir, f)),
        count: existing.length,
      };
    }

    const interval = options.interval || 1;
    const maxFrames = options.maxFrames || 30;

    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      const script = `
import cv2, os, sys, json
video_path = sys.argv[1]
out_dir = sys.argv[2]
interval = int(sys.argv[3])
max_frames = int(sys.argv[4])

cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration = total / fps if fps > 0 else 0

frame_interval = max(int(fps * interval), 1)
count = 0
saved = 0
frames = []

while saved < max_frames:
    ret, frame = cap.read()
    if not ret:
        break
    if count % frame_interval == 0:
        p = os.path.join(out_dir, f'frame_{saved:03d}.png')
        cv2.imwrite(p, frame)
        frames.append(p)
        saved += 1
    count += 1

cap.release()
print(json.dumps({"success": True, "frames": frames, "count": saved, "duration": round(duration, 1), "fps": round(fps, 1)}))
`;
      execFile('python', ['-c', script, resolved, outDir, String(interval), String(maxFrames)], {
        timeout: 60000,
        shell: false,
      }, (_error, stdout, stderr) => {
        try {
          const result = JSON.parse(stdout.trim());
          result.framesDir = outDir;
          resolve(result);
        } catch (_e) {
          resolve({
            success: false,
            error: stderr || stdout || 'Frame-Extraktion fehlgeschlagen',
          });
        }
      });
    });
  });

  // Watch images directory for changes
  let imageWatcher = null;
  function startImageWatcher() {
    try {
      if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
      let debounce = null;
      imageWatcher = fs.watch(IMAGES_DIR, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          sendToRenderer('images:changed');
        }, 500);
      });
    } catch (e) {
      console.warn('[images:watcher] Fehler:', e.message || e);
    }
  }

  function stopImageWatcher() {
    if (imageWatcher) { imageWatcher.close(); imageWatcher = null; }
  }

  return { startImageWatcher, stopImageWatcher };
}

module.exports = { registerImagesIPC };
