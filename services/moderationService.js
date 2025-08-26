const tf = require("@tensorflow/tfjs-node");
const nsfw = require("nsfwjs");
const ffmpeg = require("fluent-ffmpeg");
const {
  RegExpMatcher,
  TextCensor,
  englishDataset,
  englishRecommendedTransformers,
} = require("obscenity");

const path = require("path");
const fs = require("fs-extra");
// ✅ IMPORT: Use your existing WhisperService
const whisperService = require("./whisperService");
const config = require("../config/moderation");
class ModerationService {
  // constructor() {
  //   this.nsfwModel = null;
  //   this.matcher = new RegExpMatcher({
  //     ...englishDataset.build(),
  //     ...englishRecommendedTransformers,
  //   });
  //   this.censor = new TextCensor();
  //   this.initialized = false;
  // }
  constructor() {
    this.nsfwModel = null;
    this.initialized = false;
    // Choose a heavier built-in by name; defaults to "MobileNetV2"
    this.modelName = process.env.NSFW_MODEL_NAME || "MobileNetV2Mid";
    this.loadingPromise = null;
    // this.modelOptions = {}; // e.g., for Inception: { size: 299, type: 'graph' }
  }
  //Working wiht base modal but not the best
  // async initialize() {
  //   try {
  //     console.log("[MODERATION] Initializing NSFW model...");
  //     this.nsfwModel = await nsfw.load();
  //     this.initialized = true;
  //     console.log("[MODERATION] ✅ Model initialized successfully");
  //   } catch (error) {
  //     console.error("[MODERATION] ❌ Failed to initialize:", error);
  //     throw error;
  //   }
  // }
  //Getting 502 errors with this model
  // async initialize() {
  //   try {
  //     console.log(`[MODERATION] Loading NSFW model variant: ${this.modelName}`);
  //     this.nsfwModel = await nsfw.load(this.modelName, this.modelOptions);
  //     this.matcher = new RegExpMatcher({
  //       ...englishDataset.build(),
  //       ...englishRecommendedTransformers,
  //     });
  //     this.censor = new TextCensor();
  //     this.initialized = true;
  //     console.log("[MODERATION] ✅ NSFW model variant loaded");
  //   } catch (error) {
  //     console.error("[MODERATION] ❌ Failed to initialize NSFW model:", error);
  //     throw error;
  //   }
  // }
  async initialize() {
    if (this.initialized) return;
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = (async () => {
      console.log(
        "[MODERATION] Initializing NSFW model (MobileNetV2Mid graph)..."
      );

      // New folder layout:
      // <project-root>/models/model/mobilenet_v2_mid/{model.json, group1-shard*.bin}
      const envDir = process.env.NSFW_MODEL_DIR; // optional absolute path override
      const modelDir = envDir
        ? envDir
        : path.join(__dirname, "..", "models", "model", "mobilenet_v2_mid");

      // Verify model.json exists
      const modelJsonPath = path.join(modelDir, "model.json");
      if (!fs.existsSync(modelJsonPath)) {
        throw new Error(`Missing model.json at ${modelDir}`);
      }

      // Build proper file:// URL (normalize slashes + ensure trailing slash)
      let normalized = modelDir.replace(/\\/g, "/");
      if (!normalized.endsWith("/")) normalized += "/";
      const url = `file://${normalized}`;

      // Load as graph model (MobileNetV2Mid)
      this.nsfwModel = await nsfw.load(url, { type: "graph" });
      this.initialized = true;
      console.log("[MODERATION] ✅ NSFW model initialized");
    })();

    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  async extractFrames(videoPath) {
    const tempDir = path.join(__dirname, "../temp");
    await fs.ensureDir(tempDir);

    const videoDuration = await this.getVideoDuration(videoPath);
    const framePrefix = `frame_${Date.now()}`;

    // ✅ IMPROVED: More frames, smarter distribution
    const frameCount = Math.min(Math.max(8, Math.ceil(videoDuration / 10)), 20);
    const timestamps = [];

    // Random sampling within segments to avoid predictable patterns
    for (let i = 0; i < frameCount; i++) {
      const segmentStart = (videoDuration / frameCount) * i;
      const segmentEnd = (videoDuration / frameCount) * (i + 1);
      const randomOffset = Math.random() * (segmentEnd - segmentStart);
      timestamps.push(segmentStart + randomOffset);
    }

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: timestamps.map((t) => t.toFixed(2)),
          filename: `${framePrefix}_%03d.png`,
          folder: tempDir,
          size: "224x224",
        })
        .on("end", () => {
          const files = fs
            .readdirSync(tempDir)
            .filter((file) => file.startsWith(framePrefix))
            .map((file, index) => ({
              path: path.join(tempDir, file),
              timestamp: timestamps[index],
            }));

          console.log(`[MODERATION] Extracted ${files.length} enhanced frames`);
          resolve({ files, videoDuration });
        })
        .on("error", reject);
    });
  }

  getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          const duration = metadata.format.duration;
          resolve(duration);
        }
      });
    });
  }

  async moderateVisualContent(videoPath, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const { files: frameFiles, videoDuration } = await this.extractFrames(
        videoPath
      );
      const flaggedFrames = [];

      for (let i = 0; i < frameFiles.length; i++) {
        const frameData = frameFiles[i];
        const framePath = frameData.path;
        const exactTimestamp = frameData.timestamp;

        const imageBuffer = await fs.readFile(framePath);

        let imageTensor; // ✅ Declare outside try block
        try {
          imageTensor = tf.node.decodeImage(imageBuffer, 3);
          const predictions = await this.nsfwModel.classify(imageTensor);

          const pornScore =
            predictions.find((p) => p.className === "Porn")?.probability || 0;
          const sexyScore =
            predictions.find((p) => p.className === "Sexy")?.probability || 0;
          const hentaiScore =
            predictions.find((p) => p.className === "Hentai")?.probability || 0;

          const thresholds = this.getThresholds(
            options.strictnessLevel || "moderate"
          );

          const isInappropriate =
            pornScore > thresholds.porn ||
            sexyScore > thresholds.sexy ||
            hentaiScore > thresholds.hentai;

          if (isInappropriate) {
            flaggedFrames.push({
              frameIndex: i,
              exactTimestamp: Math.round(exactTimestamp * 100) / 100,
              timestampFormatted: this.formatDuration(exactTimestamp),
              estimatedDuration: "~1-2 seconds",
              scores: {
                porn: Math.round(pornScore * 100) / 100,
                sexy: Math.round(sexyScore * 100) / 100,
                hentai: Math.round(hentaiScore * 100) / 100,
              },
            });
          }
        } finally {
          // ✅ CORRECT: Dispose tensor after each frame
          if (imageTensor) {
            imageTensor.dispose();
          }
          // ✅ Clean up frame file
          await fs.remove(framePath).catch(() => {}); // Ignore cleanup errors
        }
      }

      return {
        flagged: flaggedFrames.length > 0,
        flaggedFrames,
        totalFramesChecked: frameFiles.length,
        videoDuration: Math.round(videoDuration * 100) / 100,
        confidence: flaggedFrames.length / frameFiles.length,
      };
    } catch (error) {
      console.error("[MODERATION] Visual moderation failed:", error);
      return { flagged: false, error: error.message };
    }
  }

  // ✅ NEW: Extract and transcribe audio using your existing WhisperService
  async extractAndTranscribeAudio(videoPath) {
    try {
      console.log(
        "[MODERATION] Starting audio transcription with WhisperService..."
      );

      // Use your existing WhisperService to transcribe the video
      const transcriptionResult = await whisperService.generateSubtitles(
        videoPath,
        {
          language: "auto", // Auto-detect language
          translateToEnglish: false, // Keep original language
          trimStart: 0, // Start from beginning
          trimEnd: null, // No trimming at end
        }
      );

      if (transcriptionResult.success && transcriptionResult.subtitles) {
        console.log(
          `[MODERATION] Audio transcription successful: ${transcriptionResult.subtitles.length} segments found`
        );
        return transcriptionResult.subtitles;
      } else {
        console.warn("[MODERATION] Audio transcription returned no subtitles");
        return [];
      }
    } catch (error) {
      console.error("[MODERATION] Audio transcription failed:", error);
      return []; // Return empty array on failure, don't break the entire moderation
    }
  }

  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);

    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, "0")}.${ms
        .toString()
        .padStart(2, "0")}`;
    } else {
      return `${secs}.${ms.toString().padStart(2, "0")}s`;
    }
  }

  moderateTextContent(subtitles) {
    try {
      if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
        console.log("[MODERATION] No subtitles to moderate");
        return {
          flagged: false,
          flaggedSubtitles: [],
          totalSubtitlesChecked: 0,
        };
      }
      const flaggedSubtitles = [];

      for (const subtitle of subtitles) {
        const originalText = subtitle.text;
        const hasProfanity = this.matcher.hasMatch(originalText);

        let cleanedText = originalText;
        if (hasProfanity) {
          const matches = this.matcher.getAllMatches(originalText);
          cleanedText = this.censor.applyTo(originalText, matches);
        }

        if (hasProfanity) {
          const matches = this.matcher.getAllMatches(originalText, true);
          const detectedWords = matches.map((match) => {
            try {
              const { phraseMetadata } =
                englishDataset.getPayloadWithPhraseMetadata(match);
              return phraseMetadata.originalWord;
            } catch (e) {
              return match.termId ? `term_${match.termId}` : "profane_word";
            }
          });

          flaggedSubtitles.push({
            ...subtitle,
            originalText,
            cleanedText,
            flagReason: "profanity",
            detectedWords: detectedWords,
          });
        }
      }

      return {
        flagged: flaggedSubtitles.length > 0,
        flaggedSubtitles,
        totalSubtitlesChecked: subtitles.length,
      };
    } catch (error) {
      console.error("[MODERATION] Text moderation failed:", error);
      return { flagged: false, error: error.message };
    }
  }

  // ✅ UPDATED: Use WhisperService for audio transcription
  async moderateVideo(videoPath, subtitles = [], options = {}) {
    try {
      console.log("[MODERATION] Starting complete video moderation...");

      // Visual content moderation
      const visualResult = await this.moderateVisualContent(videoPath, options);

      // ✅ UPDATED: Extract and transcribe audio using WhisperService if no subtitles provided
      let audioTranscription = subtitles;
      if (subtitles.length === 0) {
        console.log(
          "[MODERATION] No subtitles provided, extracting audio with WhisperService..."
        );
        audioTranscription = await this.extractAndTranscribeAudio(videoPath);
      }

      // Text content moderation
      const textResult =
        audioTranscription.length > 0
          ? this.moderateTextContent(audioTranscription)
          : { flagged: false, flaggedSubtitles: [], totalSubtitlesChecked: 0 };

      // Combined result
      const overallFlagged = visualResult.flagged || textResult.flagged;
      const confidence = this.calculateOverallConfidence(
        visualResult,
        textResult
      );

      console.log(
        `[MODERATION] Complete - Flagged: ${overallFlagged}, Confidence: ${confidence}`
      );

      return {
        flagged: overallFlagged,
        confidence,
        visual: visualResult,
        text: textResult,
        summary: {
          visualViolations: visualResult.flaggedFrames?.length || 0,
          textViolations: textResult.flaggedSubtitles?.length || 0,
          totalChecks:
            (visualResult.totalFramesChecked || 0) +
            (textResult.totalSubtitlesChecked || 0),
        },
      };
    } catch (error) {
      console.error("[MODERATION] Complete moderation failed:", error);
      return { flagged: false, error: error.message };
    }
  }

  calculateOverallConfidence(visual, text) {
    const visualWeight = 0.7;
    const textWeight = 0.3;

    const visualConf = visual.flagged ? visual.confidence || 0.8 : 0.1;
    const textConf = text.flagged ? 0.9 : 0.1;

    return (
      Math.round((visualConf * visualWeight + textConf * textWeight) * 100) /
      100
    );
  }

  isProfane(text) {
    return this.matcher.hasMatch(text);
  }

  filterText(text) {
    const matches = this.matcher.getAllMatches(text);
    return this.censor.applyTo(text, matches);
  }

  getThresholds(strictnessLevel = "moderate") {
    return config.strictnessLevels[strictnessLevel] || config.thresholds;
  }
}

module.exports = new ModerationService();
