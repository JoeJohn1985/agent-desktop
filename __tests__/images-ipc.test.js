/**
 * Unit-Tests für src/ipc/images-ipc.js
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

// Mock electron
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  shell: { openPath: jest.fn() },
}));

// Mock child_process for video frame extraction
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv']);

describe('registerImagesIPC', () => {
  let IMAGES_DIR;
  let sendToRenderer;
  let handlers;

  function getHandler(channel) {
    const call = handlers.find(c => c[0] === channel);
    if (!call) throw new Error(`Handler not found: ${channel}`);
    return call[1];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // Create a temp images directory for each test
    IMAGES_DIR = path.join(os.tmpdir(), `images-ipc-test-${Date.now()}`);
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    sendToRenderer = jest.fn();
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(IMAGES_DIR, { recursive: true, force: true });
  });

  function registerFresh() {
    const { ipcMain } = require('electron');
    ipcMain.handle.mockClear();
    const { registerImagesIPC } = require('../src/ipc/images-ipc');
    const result = registerImagesIPC({ IMAGES_DIR, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, sendToRenderer });
    handlers = ipcMain.handle.mock.calls;
    return result;
  }

  // ── Registration ──────────────────────────────────────────────

  test('registriert alle 5 IPC-Handler', () => {
    registerFresh();
    const channels = handlers.map(c => c[0]);
    expect(channels).toEqual(expect.arrayContaining([
      'images:list', 'images:open', 'images:delete', 'images:openFolder', 'videos:extractFrames',
    ]));
    expect(channels).toHaveLength(5);
  });

  test('gibt startImageWatcher und stopImageWatcher zurück', () => {
    const result = registerFresh();
    expect(typeof result.startImageWatcher).toBe('function');
    expect(typeof result.stopImageWatcher).toBe('function');
  });

  // ── images:list ───────────────────────────────────────────────

  test('images:list gibt leeres Array wenn Verzeichnis nicht existiert', async () => {
    fs.rmSync(IMAGES_DIR, { recursive: true, force: true });
    registerFresh();
    const result = await getHandler('images:list')();
    expect(result).toEqual([]);
  });

  test('images:list gibt leeres Array bei leerem Verzeichnis', async () => {
    registerFresh();
    const result = await getHandler('images:list')();
    expect(result).toEqual([]);
  });

  test('images:list listet nur Bild- und Video-Dateien', async () => {
    // Create test files
    fs.writeFileSync(path.join(IMAGES_DIR, 'photo.png'), 'data');
    fs.writeFileSync(path.join(IMAGES_DIR, 'clip.mp4'), 'data');
    fs.writeFileSync(path.join(IMAGES_DIR, 'readme.txt'), 'data'); // should be excluded
    fs.writeFileSync(path.join(IMAGES_DIR, 'shot.jpg'), 'data');

    registerFresh();
    const result = await getHandler('images:list')();

    expect(result).toHaveLength(3);
    const names = result.map(r => r.name);
    expect(names).toContain('photo.png');
    expect(names).toContain('clip.mp4');
    expect(names).toContain('shot.jpg');
    expect(names).not.toContain('readme.txt');
  });

  test('images:list sortiert nach mtime absteigend', async () => {
    fs.writeFileSync(path.join(IMAGES_DIR, 'old.png'), 'data');
    // Ensure different mtime
    const futureTime = Date.now() + 10000;
    fs.writeFileSync(path.join(IMAGES_DIR, 'new.png'), 'data');
    fs.utimesSync(path.join(IMAGES_DIR, 'new.png'), new Date(futureTime), new Date(futureTime));

    registerFresh();
    const result = await getHandler('images:list')();
    expect(result[0].name).toBe('new.png');
    expect(result[1].name).toBe('old.png');
  });

  test('images:list gibt korrekte Metadaten zurück', async () => {
    fs.writeFileSync(path.join(IMAGES_DIR, 'test.png'), 'hello');
    fs.writeFileSync(path.join(IMAGES_DIR, 'video.webm'), 'videodata');

    registerFresh();
    const result = await getHandler('images:list')();

    const img = result.find(r => r.name === 'test.png');
    expect(img.type).toBe('image');
    expect(img.size).toBe(5);
    expect(img.path).toBe(path.join(IMAGES_DIR, 'test.png'));
    expect(img.mtime).toBeGreaterThan(0);

    const vid = result.find(r => r.name === 'video.webm');
    expect(vid.type).toBe('video');
  });

  // ── images:open ───────────────────────────────────────────────

  test('images:open öffnet gültigen Pfad', async () => {
    const { shell } = require('electron');
    const filePath = path.join(IMAGES_DIR, 'test.png');
    fs.writeFileSync(filePath, 'data');

    registerFresh();
    await getHandler('images:open')({}, filePath);
    expect(shell.openPath).toHaveBeenCalledWith(filePath);
  });

  test('images:open blockiert Pfad außerhalb des Verzeichnisses', async () => {
    const { shell } = require('electron');
    registerFresh();
    await getHandler('images:open')({}, path.join(os.tmpdir(), 'evil.txt'));
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  test('images:open blockiert Pfad-Traversal', async () => {
    const { shell } = require('electron');
    registerFresh();
    await getHandler('images:open')({}, path.join(IMAGES_DIR, '..', '..', 'secret.txt'));
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  // ── images:delete ─────────────────────────────────────────────

  test('images:delete löscht Datei im Verzeichnis', async () => {
    const filePath = path.join(IMAGES_DIR, 'delete-me.png');
    fs.writeFileSync(filePath, 'data');

    registerFresh();
    await getHandler('images:delete')({}, filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('images:delete verweigert Löschung außerhalb des Verzeichnisses', async () => {
    const externalFile = path.join(os.tmpdir(), `external-${Date.now()}.txt`);
    fs.writeFileSync(externalFile, 'precious');

    registerFresh();
    await getHandler('images:delete')({}, externalFile);
    expect(fs.existsSync(externalFile)).toBe(true);
    fs.unlinkSync(externalFile); // cleanup
  });

  test('images:delete ignoriert nicht existierende Dateien', async () => {
    registerFresh();
    // Should not throw
    await getHandler('images:delete')({}, path.join(IMAGES_DIR, 'nonexistent.png'));
  });

  // ── images:openFolder ─────────────────────────────────────────

  test('images:openFolder öffnet das Bilderverzeichnis', async () => {
    const { shell } = require('electron');
    registerFresh();
    await getHandler('images:openFolder')();
    expect(shell.openPath).toHaveBeenCalledWith(IMAGES_DIR);
  });

  // ── videos:extractFrames ──────────────────────────────────────

  test('videos:extractFrames gibt Fehler bei ungültigem Pfad', async () => {
    registerFresh();
    const result = await getHandler('videos:extractFrames')({}, 123);
    expect(result).toEqual({ success: false, error: 'Ungültiger Pfad' });
  });

  test('videos:extractFrames gibt Fehler bei nicht-existierender Datei', async () => {
    registerFresh();
    const result = await getHandler('videos:extractFrames')({}, '/nonexistent/video.mp4');
    expect(result).toEqual({ success: false, error: 'Datei nicht gefunden' });
  });

  test('videos:extractFrames gibt cached Frames zurück', async () => {
    const videoPath = path.join(IMAGES_DIR, 'test.mp4');
    fs.writeFileSync(videoPath, 'fake-video');

    // Create cached frames
    const framesDir = path.join(IMAGES_DIR, '_frames', 'test');
    fs.mkdirSync(framesDir, { recursive: true });
    fs.writeFileSync(path.join(framesDir, 'frame_000.png'), 'frame');
    fs.writeFileSync(path.join(framesDir, 'frame_001.png'), 'frame');

    registerFresh();
    const result = await getHandler('videos:extractFrames')({}, videoPath);

    expect(result.success).toBe(true);
    expect(result.cached).toBe(true);
    expect(result.count).toBe(2);
    expect(result.frames).toHaveLength(2);
    expect(result.framesDir).toBe(framesDir);
  });

  test('videos:extractFrames extrahiert Frames mit Python', async () => {
    const { execFile } = require('child_process');
    const videoPath = path.join(IMAGES_DIR, 'new.mp4');
    fs.writeFileSync(videoPath, 'fake-video');

    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, JSON.stringify({ success: true, frames: ['frame_000.png'], count: 1, duration: 5.0, fps: 30.0 }), '');
    });

    registerFresh();
    const result = await getHandler('videos:extractFrames')({}, videoPath, { force: true });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(execFile).toHaveBeenCalledWith('python', expect.any(Array), expect.objectContaining({ timeout: 60000 }), expect.any(Function));
  });

  test('videos:extractFrames behandelt Python-Fehler', async () => {
    const { execFile } = require('child_process');
    const videoPath = path.join(IMAGES_DIR, 'broken.mp4');
    fs.writeFileSync(videoPath, 'fake');

    execFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error('python failed'), '', 'ModuleNotFoundError: cv2');
    });

    registerFresh();
    const result = await getHandler('videos:extractFrames')({}, videoPath, { force: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cv2');
  });

  // ── Image Watcher ─────────────────────────────────────────────

  test('startImageWatcher erstellt Verzeichnis wenn nötig', () => {
    const watchDir = path.join(IMAGES_DIR, 'sub', 'watch');
    // Use a custom IMAGES_DIR that doesn't exist yet
    const { ipcMain: ipc } = require('electron');
    ipc.handle.mockClear();
    const { registerImagesIPC } = require('../src/ipc/images-ipc');
    const { startImageWatcher, stopImageWatcher } = registerImagesIPC({
      IMAGES_DIR: watchDir, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, sendToRenderer,
    });

    startImageWatcher();
    expect(fs.existsSync(watchDir)).toBe(true);
    stopImageWatcher(); // cleanup
  });

  test('stopImageWatcher schließt den Watcher', () => {
    registerFresh();
    const { startImageWatcher, stopImageWatcher } = registerFresh();
    startImageWatcher();
    // Should not throw
    stopImageWatcher();
    stopImageWatcher(); // idempotent
  });

  test('imageWatcher sendet images:changed Event (debounced)', () => {
    jest.useFakeTimers();
    let watchCallback;
    const mockWatcher = { close: jest.fn() };
    const watchSpy = jest.spyOn(fs, 'watch').mockImplementation((_dir, cb) => {
      watchCallback = cb;
      return mockWatcher;
    });

    const { ipcMain: ipc } = require('electron');
    ipc.handle.mockClear();
    const { registerImagesIPC } = require('../src/ipc/images-ipc');
    const { startImageWatcher, stopImageWatcher } = registerImagesIPC({
      IMAGES_DIR, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, sendToRenderer,
    });

    startImageWatcher();
    expect(watchCallback).toBeDefined();

    // Simulate a file change event
    watchCallback('change', 'file.png');

    // Before debounce fires
    expect(sendToRenderer).not.toHaveBeenCalled();

    // Advance past debounce (500ms)
    jest.advanceTimersByTime(600);
    expect(sendToRenderer).toHaveBeenCalledWith('images:changed');

    stopImageWatcher();
    watchSpy.mockRestore();
    jest.useRealTimers();
  });
});
