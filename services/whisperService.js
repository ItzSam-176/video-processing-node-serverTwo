// services/whisperService.js
const { nodewhisper } = require("nodejs-whisper");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const { spawnSync, spawn } = require("node:child_process");

class WhisperService {
  constructor() {
    this.modelName = process.env.WHISPER_MODEL || "tiny";
    this.initialized = false;

    // Resolve a deterministic, writable cache directory
    const home =
      (os.homedir && typeof os.homedir === "function" && os.homedir()) || null;

    const baseDir =
      process.env.WHISPER_CACHE ||
      process.env.WHISPER_CACHE_DIR ||
      home ||
      process.env.HOME ||
      process.env.USERPROFILE ||
      "/app/models"; // container-safe fallback

    // Final cache root for model files
    this.modelCacheRoot = path.resolve(
      baseDir
        ? path.join(baseDir, ".cache", "whisper-node")
        : "/tmp/whisper-node"
    );
  }

  // Initialize by warming up the model via non-interactive autoDownload
  async initialize() {
    if (this.initialized) return;

    try {
      // Ensure cache dir exists and is writable
      await fs.ensureDir(this.modelCacheRoot);

      // Non-interactive warm-up: create a 1s silent WAV, let autoDownload fetch the model
      const warmupWav = path.join(
        __dirname,
        "../temp",
        `warmup_${uuidv4()}.wav`
      );
      await this._makeSilentWav(warmupWav);

      // Use env to hint cache location to downstream tools
      const env = {
        ...process.env,
        WHISPER_CACHE: this.modelCacheRoot,
        WHISPER_CACHE_DIR: this.modelCacheRoot,
      };

      // Run a minimal transcription to trigger download without prompting
      await nodewhisper(warmupWav, {
        modelName: this.modelName,
        autoDownloadModelName: this.modelName,
        logger: console,
        whisperOptions: {
          outputInCsv: false,
          outputInJson: false,
          outputInJsonFull: false,
          outputInLrc: false,
          outputInSrt: false,
          outputInText: false,
          outputInVtt: false,
          outputInWords: false,
          translateToEnglish: false,
          wordTimestamps: false,
          timestamps_length: 20,
          splitOnWord: true,
        },
        env, // pass-through for some wrappers that honor env variables
      });

      await fs.remove(warmupWav).catch(() => {});
      this.initialized = true;
      console.log("[WHISPER] ✅ Model warmed up (non-interactive)");
    } catch (err) {
      console.error("[WHISPER] Initialization failed:", err);
      throw err;
    }
  }

  // Optional: direct non-interactive fetch if you want to pre-download without warm-up
  // Toggle by calling await this.directDownloadIfMissing() before initialize()
  async directDownloadIfMissing() {
    await fs.ensureDir(this.modelCacheRoot);

    const candidates = [
      path.join(this.modelCacheRoot, `ggml-${this.modelName}.bin`),
      path.join(
        this.modelCacheRoot,
        this.modelName,
        `ggml-${this.modelName}.bin`
      ),
      path.join(this.modelCacheRoot, `${this.modelName}.bin`),
    ];
    for (const p of candidates) {
      if (await fs.pathExists(p)) {
        const st = await fs.stat(p).catch(() => null);
        if (st && st.isFile() && st.size > 10 * 1024 * 1024) {
          console.log(`[WHISPER] Model exists at: ${p}`);
          return;
        }
      }
    }

    // Direct model URL (adjust if using another mirror/model family)
    const fileName = `ggml-${this.modelName}.bin`;
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`;
    const target = path.join(this.modelCacheRoot, fileName);

    console.log(
      `[WHISPER] Downloading model to ${target} (non-interactive)...`
    );
    await new Promise((resolve, reject) => {
      const c = spawn("curl", ["-L", "-o", target, url], { stdio: "inherit" });
      c.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`curl exit ${code}`))
      );
    });

    const st = await fs.stat(target).catch(() => null);
    if (!st || !st.isFile() || st.size < 10 * 1024 * 1024) {
      throw new Error("Model download appears incomplete or missing.");
    }
    console.log("[WHISPER] ✅ Direct model download complete");
  }

  async _makeSilentWav(filePath) {
    await fs.ensureDir(path.dirname(filePath));
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input("anullsrc=r=16000:cl=mono")
        .inputOptions(["-f", "lavfi"])
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .duration(1)
        .output(filePath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });
  }

  async extractAudio(videoPath, trimStart = 0, trimEnd = null) {
    console.log("[WHISPER] Extracting audio from video");
    const audioPath = path.join(__dirname, "../temp", `audio_${uuidv4()}.wav`);

    return new Promise((resolve, reject) => {
      let command = ffmpeg(videoPath);
      if (trimStart > 0) command.seekInput(trimStart);
      if (trimEnd !== null && trimEnd > trimStart)
        command.duration(trimEnd - trimStart);
      command
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .outputOptions(["-ac", "1", "-ar", "16000"])
        .output(audioPath)
        .on("end", () => resolve(audioPath))
        .on("error", reject)
        .run();
    });
  }

  parseWhisperOutput(stdout, trimStartOffset = 0) {
    const subtitles = [];
    try {
      const lines = String(stdout).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || !line.startsWith("[")) continue;
        const match = line.match(
          /^\[(\d{2}:\d{2}:\d{2}[\.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[\.,]\d{3})\]\s*(.+)$/
        );
        if (match) {
          const startTime =
            this.timestampToSeconds(match[1]) + (trimStartOffset || 0);
          const endTime =
            this.timestampToSeconds(match[2]) + (trimStartOffset || 0);
          const text = match[3].trim();
          if (
            !isNaN(startTime) &&
            !isNaN(endTime) &&
            startTime < endTime &&
            text
          ) {
            subtitles.push({ start: startTime, end: endTime, text });
          }
        }
      }
      return subtitles;
    } catch (e) {
      console.error("[WHISPER] parse error:", e);
      return [];
    }
  }

  timestampToSeconds(ts) {
    try {
      const clean = String(ts).replace(",", ".");
      const [h, m, s] = clean.split(":");
      const hours = parseInt(h, 10) || 0;
      const mins = parseInt(m, 10) || 0;
      const secs = parseFloat(s) || 0;
      return hours * 3600 + mins * 60 + secs;
    } catch {
      return 0;
    }
  }

  async generateSubtitles(inputPath, params = {}) {
    console.log("[WHISPER] Starting subtitle generation");
    await this.initialize();

    const audioPath = await this.extractAudio(
      inputPath,
      params.trimStart || 0,
      params.trimEnd ?? null
    );

    try {
      const env = {
        ...process.env,
        WHISPER_CACHE: this.modelCacheRoot,
        WHISPER_CACHE_DIR: this.modelCacheRoot,
      };

      const result = await nodewhisper(audioPath, {
        modelName: this.modelName,
        autoDownloadModelName: this.modelName, // non-interactive
        logger: console,
        whisperOptions: {
          language: params.language === "auto" ? null : params.language,
          translateToEnglish: !!params.translateToEnglish,
          outputInCsv: false,
          outputInJson: false,
          outputInJsonFull: false,
          outputInLrc: false,
          outputInSrt: false,
          outputInText: false,
          outputInVtt: false,
          outputInWords: false,
          wordTimestamps: true,
          timestamps_length: 23,
          splitOnWord: true,
        },
        env,
      });

      const subtitles = this.parseWhisperOutput(result, params.trimStart || 0);
      return {
        success: true,
        subtitles,
        detected_language: "en",
        segments_count: subtitles.length,
        message: `Generated ${subtitles.length} timed subtitle segments`,
      };
    } catch (error) {
      console.error("[WHISPER] Subtitle generation failed:", error);
      throw new Error(`Whisper transcription failed: ${error.message}`);
    } finally {
      await fs.remove(audioPath).catch(() => {});
    }
  }
}

module.exports = new WhisperService();
