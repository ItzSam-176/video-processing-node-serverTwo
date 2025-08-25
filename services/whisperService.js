const {nodewhisper} = require("nodejs-whisper");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");
const { spawnSync } = require("node:child_process");

class WhisperService {
  constructor() {
    this.modelName = "tiny";
    this.initialized = false;
    this._initPromise = null;
  }
  async _makeSilentWav(filePath) {
    await fs.ensureDir(path.dirname(filePath));
    return new Promise((resolve, reject) => {
      // Generate 1-second silent mono 16kHz PCM WAV using lavfi anullsrc
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
  async initialize() {
    if (this.initialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      const whichWhisper = spawnSync("which", ["whisper-cli"], {
        encoding: "utf8",
      });
      const whisperPath =
        whichWhisper.status === 0 ? whichWhisper.stdout.trim() : null;

      if (whisperPath) {
        console.log("[WHISPER] whisper-cli path:", whisperPath);
      } else {
        console.warn(
          "[WHISPER] whisper-cli not found in PATH:",
          whichWhisper.stderr || whichWhisper.stdout
        );
      }

      // Try `whisper-cli -h` to confirm executable works
      const help = spawnSync(whisperPath || "whisper-cli", ["-h"], {
        encoding: "utf8",
      });
      if (help.status !== 0) {
        const msg = help.error
          ? help.error.message
          : help.stderr || help.stdout || "unknown error";
        console.warn("[WHISPER] whisper-cli -h failed:", msg);
        // Fail fast so deploy logs clearly state what's wrong
        throw new Error(
          "whisper-cli executable not found or not runnable. Ensure it is installed and in PATH."
        );
      }

      const warmupWav = path.join(
        __dirname,
        "../temp",
        `warmup_${uuidv4()}.wav`
      );
      try {
        console.log(
          "[WHISPER] Warming up model (may download on first run)..."
        );
        await this._makeSilentWav(warmupWav);
        // Trigger model download/init
        await nodewhisper(warmupWav, {
          modelName: this.modelName,
          autoDownloadModelName: this.modelName,
          // keep options minimal for warmup
          whisperOptions: {
            outputInSrt: false,
            outputInText: false,
            outputInVtt: false,
            outputInJson: false,
            outputInCsv: false,
            outputInWords: false,
            translateToEnglish: false,
            wordTimestamps: false,
            splitOnWord: true,
          },
        });
        this.initialized = true;
        console.log("[WHISPER] ✅ Model warmed up");
      } catch (err) {
        console.error("[WHISPER] Warmup failed:", err);
        throw err;
      } finally {
        await fs.remove(warmupWav).catch(() => {});
      }
    })();

    return this._initPromise;
  }

  async extractAudio(videoPath, trimStart = 0, trimEnd = null) {
    console.log("[WHISPER] Extracting audio from video");

    const audioPath = path.join(__dirname, "../temp", `audio_${uuidv4()}.wav`);

    return new Promise((resolve, reject) => {
      let command = ffmpeg(videoPath);

      if (trimStart > 0) {
        command.seekInput(trimStart);
      }

      if (trimEnd !== null && trimEnd > trimStart) {
        command.duration(trimEnd - trimStart);
      }

      command
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .outputOptions(["-ac", "1", "-ar", "16000"])
        .output(audioPath)
        .on("end", () => {
          console.log("[WHISPER] Audio extracted successfully");
          resolve(audioPath);
        })
        .on("error", (error) => {
          console.error("[WHISPER] Audio extraction failed:", error);
          reject(error);
        })
        .run();
    });
  }

  // ✅ COMPLETELY FIXED: Parse Whisper's output with proper regex
  parseWhisperOutput(stdout, trimStartOffset = 0) {
    const subtitles = [];

    try {
      console.log("[WHISPER] Parsing Whisper output...");
      console.log("[WHISPER] Output sample:", stdout.substring(0, 300));

      // Split the output by lines
      const lines = stdout.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip empty lines or lines without brackets
        if (!line || !line.startsWith("[")) continue;

        console.log(`[WHISPER] Processing line ${i}: "${line}"`);

        // ✅ FIXED: Use regex that captures both timestamp formats
        const match = line.match(
          /^\[(\d{2}:\d{2}:\d{2}[\.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[\.,]\d{3})\]\s*(.+)$/
        );

        if (match) {
          const startTimeStr = match[1];
          const endTimeStr = match[2];
          const text = match[3].trim();

          console.log(
            `[WHISPER] Extracted - Start: "${startTimeStr}", End: "${endTimeStr}", Text: "${text}"`
          );

          if (!text || text.length === 0) {
            console.log("[WHISPER] Skipping - no text content");
            continue;
          }

          // Convert to seconds
          const startTime =
            this.timestampToSeconds(startTimeStr) + trimStartOffset;
          const endTime = this.timestampToSeconds(endTimeStr) + trimStartOffset;

          console.log(`[WHISPER] Converted times: ${startTime}s - ${endTime}s`);

          if (!isNaN(startTime) && !isNaN(endTime) && startTime < endTime) {
            subtitles.push({
              start: startTime,
              end: endTime,
              text: text,
            });

            console.log(
              `[WHISPER] ✅ Added subtitle: ${startTime.toFixed(
                1
              )}s-${endTime.toFixed(1)}s = "${text}"`
            );
          } else {
            console.log(
              `[WHISPER] ❌ Invalid times or logic: start=${startTime}, end=${endTime}`
            );
          }
        } else {
          console.log(`[WHISPER] ❌ Line didn't match regex pattern`);
        }
      }

      console.log(
        `[WHISPER] Successfully parsed ${subtitles.length} subtitles`
      );
      return subtitles;
    } catch (error) {
      console.error("[WHISPER] Error parsing output:", error);
      return [];
    }
  }

  // ✅ FIXED: Convert timestamp to seconds
  timestampToSeconds(timestamp) {
    try {
      if (!timestamp || typeof timestamp !== "string") {
        console.error("[WHISPER] Invalid timestamp input:", timestamp);
        return 0;
      }

      // Handle both comma and dot decimal separators
      const cleanTimestamp = timestamp.replace(",", ".");

      console.log(
        `[WHISPER] Converting timestamp: "${timestamp}" -> "${cleanTimestamp}"`
      );

      const parts = cleanTimestamp.split(":");
      if (parts.length !== 3) {
        console.error("[WHISPER] Invalid timestamp format:", cleanTimestamp);
        return 0;
      }

      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      const seconds = parseFloat(parts[2]) || 0;

      const totalSeconds = hours * 3600 + minutes * 60 + seconds;

      console.log(
        `[WHISPER] Parsed: ${hours}h ${minutes}m ${seconds}s = ${totalSeconds}s`
      );

      return totalSeconds;
    } catch (error) {
      console.error("[WHISPER] Error converting timestamp:", timestamp, error);
      return 0;
    }
  }

  // ✅ MAIN: Generate subtitles using Whisper's exact timestamps
  async generateSubtitles(inputPath, params) {
    console.log(
      "[WHISPER] Starting subtitle generation with Whisper timestamps"
    );

    try {
      await this.initialize();

      const audioPath = await this.extractAudio(
        inputPath,
        params.trimStart,
        params.trimEnd
      );

      console.log("[WHISPER] Running Whisper transcription...");

      const result = await nodewhisper(audioPath, {
        modelName: this.modelName,
        autoDownloadModelName: this.modelName,
        whisperOptions: {
          // null for auto language detection per nodejs-whisper
          language: params.language === "auto" ? null : params.language,
          translateToEnglish: !!params.translateToEnglish,
          // disable all file outputs; we parse stdout
          outputInCsv: false,
          outputInJson: false,
          outputInJsonFull: false,
          outputInLrc: false,
          outputInSrt: false,
          outputInText: false,
          outputInVtt: false,
          outputInWords: false,
          // timestamps settings supported by wrapper
          wordTimestamps: true,
          timestamps_length: 23,
          splitOnWord: true,
        },
      });


      console.log("[WHISPER] Whisper result type:", typeof result);

      // ✅ Parse using Whisper's direct output
      const subtitles = this.parseWhisperOutput(result, params.trimStart || 0);

      // Cleanup
      fs.remove(audioPath).catch(() => {});

      console.log(
        `[WHISPER] Generated ${subtitles.length} timed subtitle segments`
      );

      return {
        success: true,
        subtitles: subtitles,
        detected_language: "en",
        segments_count: subtitles.length,
        message: `Generated ${subtitles.length} timed subtitle segments`,
      };
    } catch (error) {
      console.error("[WHISPER] Subtitle generation failed:", error);
      throw new Error(`Whisper transcription failed: ${error.message}`);
    }
  }
}

module.exports = new WhisperService();
