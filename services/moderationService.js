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

class ModerationService {
  constructor() {
    this.nsfwModel = null;
    this.matcher = new RegExpMatcher({
      ...englishDataset.build(),
      ...englishRecommendedTransformers,
    });
    this.censor = new TextCensor();
    this.initialized = false;
  }

  async initialize() {
    try {
      console.log("[MODERATION] Initializing NSFW model...");
      this.nsfwModel = await nsfw.load();
      this.initialized = true;
      console.log("[MODERATION] ✅ Model initialized successfully");
    } catch (error) {
      console.error("[MODERATION] ❌ Failed to initialize:", error);
      throw error;
    }
  }

  async extractFrames(videoPath) {
    const tempDir = path.join(__dirname, "../temp");
    await fs.ensureDir(tempDir);

    const videoDuration = await this.getVideoDuration(videoPath);
    const framePrefix = `frame_${Date.now()}`;

    const frameTimestamps = [
      videoDuration * 0.1,
      videoDuration * 0.25,
      videoDuration * 0.5,
      videoDuration * 0.75,
      videoDuration * 0.9,
    ];

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: frameTimestamps.map((t) => t.toFixed(2)),
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
              timestamp: frameTimestamps[index],
            }));

          console.log(
            `[MODERATION] Extracted ${files.length} frames with timestamps`
          );
          resolve({ files, videoDuration });
        })
        .on("error", (error) => {
          console.error("[MODERATION] Frame extraction failed:", error);
          reject(error);
        });
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

  async moderateVisualContent(videoPath) {
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

          const isInappropriate =
            pornScore > 0.6 || sexyScore > 0.8 || hentaiScore > 0.7;

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
  async moderateVideo(videoPath, subtitles = []) {
    try {
      console.log("[MODERATION] Starting complete video moderation...");

      // Visual content moderation
      const visualResult = await this.moderateVisualContent(videoPath);

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
}

module.exports = new ModerationService();
