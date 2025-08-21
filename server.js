const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs-extra");
const { englishDataset } = require("obscenity");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

const multer = require("multer");
const upload = multer({ dest: path.join(__dirname, "uploads") });
const whisperService = require("./services/whisperService");
const moderationService = require("./services/moderationService");

// Create directories on startup
const createDirectories = async () => {
  const dirs = ["uploads", "processed", "temp", "models"];
  for (const dir of dirs) {
    await fs.ensureDir(path.join(__dirname, dir));
  }
};
createDirectories();

// Health check
app.get("/", (req, res) =>
  res.json({ status: "Video Processor API is running!" })
);
app.get("/health", (req, res) =>
  res.json({ status: "OK", timestamp: new Date() })
);

// Routes
app.post(
  "/process-video",
  require("./controllers/videoController").processVideo
);
app.post(
  "/generate-subtitles",
  require("./controllers/subtitleController").generateSubtitles
);

// New endpoint: /generate-subtitles-only
app.post(
  "/generate-subtitles-only",
  upload.single("video"),
  async (req, res) => {
    try {
      const { language = "auto", translate_to_english = "false" } = req.body;

      // Generate subtitles using Whisper
      const subtitles = await whisperService.generateSubtitles(req.file.path, {
        language,
        translateToEnglish: translate_to_english === "true",
      });

      // Return ONLY subtitles object
      res.json({
        success: true,
        subtitles: subtitles,
        videoMetadata: {
          originalName: req.file.originalname,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ✅ Enhanced process-video with safety check
app.post("/process-video-safe", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "No video file provided",
      });
    }

    const strictnessLevel =
      req.body.strictness ||
      req.headers["x-moderation-strictness"] ||
      "moderate";
    // Step 1: Safety check first
    const moderationResult = await moderationService.moderateVisualContent(
      req.file.path,
      { strictnessLevel }
    );

    if (moderationResult.flagged) {
      const issues = [];

      moderationResult.flaggedFrames.forEach((frame) => {
        const scores = frame.scores;
        if (scores.porn > 0.6) issues.push("Adult content");
        if (scores.sexy > 0.8) issues.push("Suggestive content");
        if (scores.hentai > 0.7) issues.push("Inappropriate animated content");
      });

      return res.status(400).json({
        safe: false,
        message: "❌ Cannot process video - inappropriate content detected",
        issues: [...new Set(issues)],
        blocked: true,
      });
    }

    // Step 2: Video is safe - process normally
    console.log(
      `[SAFE-PROCESSING] ✅ Video passed safety check, processing...`
    );

    // Call your existing video processing logic here
    const videoController = require("./controllers/videoController");
    return videoController.processVideo(req, res);
  } catch (error) {
    console.error("[SAFE-PROCESSING] Error:", error);
    res.status(500).json({
      safe: false,
      message: "Processing failed",
      error: error.message,
    });
  }
});

app.post(
  "/check-video-safety-with-duration",
  upload.single("video"),
  async (req, res) => {
    try {
      if (!req.file && !req.body.text) {
        return res.status(400).json({
          safe: false,
          message: "No video file or text provided",
        });
      }

      let visualResult = {
        flagged: false,
        flaggedFrames: [],
        totalFramesChecked: 0,
        videoDuration: 0,
      };
      let audioResult = {
        flagged: false,
        flaggedSubtitles: [],
        totalSubtitlesChecked: 0,
      };
      let textResult = { flagged: false, flaggedText: null };
      const strictnessLevel =
        req.body.strictness ||
        req.headers["x-moderation-strictness"] ||
        "moderate";
      // 1. Video Visual Moderation (if video file provided)
      if (req.file) {
        console.log("[SAFETY-CHECK] Checking video visual content...");
        visualResult = await moderationService.moderateVisualContent(
          req.file.path,
          { strictnessLevel }
        );
      }

      // 2. Audio Moderation (✅ CLEANED UP: Use moderationService)
      if (req.file) {
        console.log("[SAFETY-CHECK] Extracting and checking audio content...");
        try {
          const audioTranscription =
            await moderationService.extractAndTranscribeAudio(req.file.path);
          // ✅ SAFE: Add proper validation
          if (
            audioTranscription &&
            Array.isArray(audioTranscription) &&
            audioTranscription.length > 0
          ) {
            // Validate that each subtitle has required properties
            const validSubtitles = audioTranscription.filter(
              (subtitle) =>
                subtitle &&
                typeof subtitle === "object" &&
                subtitle.text &&
                subtitle.text.trim().length > 0
            );

            if (validSubtitles.length > 0) {
              audioResult =
                moderationService.moderateTextContent(validSubtitles);
            } else {
              console.log(
                "[SAFETY-CHECK] No valid subtitles found for audio moderation"
              );
            }
          } else {
            console.log(
              "[SAFETY-CHECK] Audio transcription returned no results"
            );
          }
        } catch (audioError) {
          console.warn(
            "[SAFETY-CHECK] Audio extraction failed:",
            audioError.message
          );
        }
      }

      // 3. Text Moderation (if text provided in request body)
      if (req.body.text) {
        console.log("[SAFETY-CHECK] Checking provided text content...");
        const providedText = req.body.text.trim();
        const hasProfanity = moderationService.isProfane(providedText);

        if (hasProfanity) {
          const cleanedText = moderationService.filterText(providedText);
          const matches = moderationService.matcher.getAllMatches(
            providedText,
            true
          );
          const detectedWords = matches.map((match) => {
            try {
              const { phraseMetadata } =
                englishDataset.getPayloadWithPhraseMetadata(match);
              return phraseMetadata.originalWord;
            } catch (e) {
              return match.termId ? `term_${match.termId}` : "profane_word";
            }
          });

          textResult = {
            flagged: true,
            flaggedText: {
              originalText: providedText,
              cleanedText: cleanedText,
              detectedWords: detectedWords,
              flagReason: "profanity",
            },
          };
        }
      }

      // Determine overall safety
      const overallFlagged =
        visualResult.flagged || audioResult.flagged || textResult.flagged;

      if (!overallFlagged) {
        // ✅ SAFE RESPONSE - Show all details when safe
        return res.json({
          safe: true,
          message: "✅ Content is safe to use",
          videoDuration: req.file ? visualResult.videoDuration + "s" : "N/A",
          summary: {
            contentTypes: {
              video: req.file ? "checked" : "not_provided",
              audio: req.file ? "checked" : "not_provided",
              text: req.body.text ? "checked" : "not_provided",
            },
            totalChecks: {
              framesChecked: visualResult.totalFramesChecked,
              audioSegmentsChecked: audioResult.totalSubtitlesChecked,
              textProvided: !!req.body.text,
            },
          },
        });
      } else {
        // ❌ UNSAFE RESPONSE - Only show violated content
        const violationReport = {
          safe: false,
          message: "❌ Content contains inappropriate material",
        };

        // Only add videoDuration if video was provided
        if (req.file) {
          violationReport.videoDuration = visualResult.videoDuration + "s";
        }

        // Build violation summary with only non-zero counts
        const violationSummary = {};
        let totalViolations = 0;

        if (visualResult.flagged) {
          violationSummary.visualViolations = visualResult.flaggedFrames.length;
          totalViolations += visualResult.flaggedFrames.length;
        }

        if (audioResult.flagged) {
          violationSummary.audioViolations =
            audioResult.flaggedSubtitles.length;
          totalViolations += audioResult.flaggedSubtitles.length;
        }

        if (textResult.flagged) {
          violationSummary.textViolations = 1;
          totalViolations += 1;
        }

        violationSummary.totalViolations = totalViolations;
        violationReport.violationSummary = violationSummary;

        // Only include violation details for flagged content types
        const violations = {};

        // Visual violations (only if flagged)
        if (visualResult.flagged) {
          violations.visual = visualResult.flaggedFrames.map((frame) => {
            const issues = [];
            if (frame.scores.porn > 0.6) {
              issues.push(
                `Explicit content (${Math.round(
                  frame.scores.porn * 100
                )}% confidence)`
              );
            }
            if (frame.scores.sexy > 0.8) {
              issues.push(
                `Suggestive content (${Math.round(
                  frame.scores.sexy * 100
                )}% confidence)`
              );
            }
            if (frame.scores.hentai > 0.7) {
              issues.push(
                `Inappropriate animation (${Math.round(
                  frame.scores.hentai * 100
                )}% confidence)`
              );
            }

            return {
              type: "visual",
              timestamp: frame.exactTimestamp + "s",
              timestampFormatted: frame.timestampFormatted,
              estimatedDuration: frame.estimatedDuration,
              issues: issues,
            };
          });
        }

        // Audio violations (only if flagged)
        if (audioResult.flagged) {
          violations.audio = audioResult.flaggedSubtitles.map((subtitle) => ({
            type: "audio",
            startTime: (subtitle.start || 0) + "s",
            endTime: (subtitle.end || subtitle.start + 3) + "s",
            duration:
              formatDuration(subtitle.start || 0) +
              " - " +
              formatDuration(subtitle.end || subtitle.start + 3),
            spokenText: subtitle.originalText,
            cleanedText: subtitle.cleanedText,
            detectedWords: subtitle.detectedWords || [],
            flagReason: subtitle.flagReason,
          }));
        }

        // Text violations (only if flagged)
        if (textResult.flagged) {
          violations.text = {
            type: "provided_text",
            originalText: textResult.flaggedText.originalText,
            cleanedText: textResult.flaggedText.cleanedText,
            detectedWords: textResult.flaggedText.detectedWords,
            flagReason: textResult.flaggedText.flagReason,
          };
        }

        violationReport.violations = violations;

        // Calculate violation percentages (only if video provided)
        if (req.file && visualResult.videoDuration > 0) {
          const totalViolationTime =
            (violationSummary.visualViolations || 0) * 1.5 +
            (violationSummary.audioViolations || 0) * 2;
          if (totalViolationTime > 0) {
            const violationPercentage = Math.round(
              (totalViolationTime / visualResult.videoDuration) * 100
            );
            violationReport.violationSummary.totalViolationTime =
              totalViolationTime + "s";
            violationReport.violationSummary.violationPercentage =
              violationPercentage + "%";
          }
        }

        return res.json(violationReport);
      }
    } catch (error) {
      console.error("[SAFETY-CHECK] Comprehensive check failed:", error);
      return res.status(500).json({
        safe: false,
        message: "❌ Failed to check content safety",
        error: error.message,
      });
    }
  }
);

// ✅ KEPT: Helper function (used in response formatting)
function formatDuration(seconds) {
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

// Serve processed files
app.use("/processed-videos", express.static("processed"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Video Processor Server running on port ${PORT}`);
});
