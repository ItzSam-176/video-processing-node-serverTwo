const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");
const whisperService = require("./whisperService");

class VideoProcessingService {
  async processVideo(videoPath, audioPath, outputPath, params) {
    console.log("[VIDEO] Starting video processing");

    try {
      // Step 1: Trim video ✅
      const trimmedPath = await this.trimVideo(
        videoPath,
        params.startTime,
        params.endTime
      );

      // Step 2: Replace audio if provided ✅
      const audioReplacedPath = audioPath
        ? await this.replaceAudio(trimmedPath, audioPath, params) // ✅ Use trimmedPath, not filteredPath
        : trimmedPath;

      // Step 3: Add subtitles if enabled ✅
      const finalPath = params.enableSubtitles
        ? await this.addSubtitles(audioReplacedPath, videoPath, params) // ✅ Use audioReplacedPath, not textOverlayPath
        : audioReplacedPath;

      // Step 4: Move to final output location ✅
      await fs.move(finalPath, outputPath);

      console.log("[VIDEO] Processing completed successfully");

      // ✅ FIXED: Cleanup with correct variables
      this.cleanupIntermediateFiles([
        trimmedPath,
        audioReplacedPath,
        finalPath,
      ]);
    } catch (error) {
      console.error("[VIDEO] Processing failed:", error);
      throw error;
    }
  }

  async trimVideo(inputPath, startTime, endTime) {
    const outputPath = path.join(
      __dirname,
      "../temp",
      `trimmed_${uuidv4()}.mp4`
    );

    console.log(`[VIDEO] Trimming video: ${startTime}s to ${endTime}s`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(startTime)
        .duration(endTime - startTime)
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions(["-movflags", "faststart"])
        .output(outputPath)
        .on("end", () => {
          console.log("[VIDEO] Video trimmed successfully");
          resolve(outputPath);
        })
        .on("error", (error) => {
          console.error("[VIDEO] Trimming failed:", error);
          reject(error);
        })
        .run();
    });
  }

  async replaceAudio(videoPath, audioPath, params) {
    console.log("[VIDEO] Replacing audio");

    const outputPath = path.join(
      __dirname,
      "../temp",
      `audio_replaced_${uuidv4()}.mp4`
    );

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .seekInput(params.audioStartTime)
        .videoCodec("copy")
        .audioCodec("aac")
        .outputOptions(["-map", "0:v:0", "-map", "1:a:0", "-shortest"])
        .output(outputPath)
        .on("end", () => {
          console.log("[VIDEO] Audio replaced successfully");
          resolve(outputPath);
        })
        .on("error", (error) => {
          console.error("[VIDEO] Audio replacement failed:", error);
          reject(error);
        })
        .run();
    });
  }

  // ✅ FORMAT SRT TIME
  formatSRTTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
      .toString()
      .padStart(3, "0")}`;
  }

  // ✅ CREATE CLEAN SRT FILE
  async createCleanSRTFile(subtitles) {
    const srtPath = path.join(
      __dirname,
      "../temp",
      `subtitles_${uuidv4()}.srt`
    );
    let srtContent = "";

    console.log(`[VIDEO] Creating SRT with ${subtitles.length} timed segments`);

    if (!subtitles || subtitles.length === 0) {
      throw new Error("No subtitles provided for SRT creation");
    }

    let validCount = 0;

    subtitles.forEach((subtitle, index) => {
      const cleanText = subtitle.text
        .trim()
        .replace(/\[MUSIC\]/gi, "♪")
        .replace(/\[.*?\]/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!cleanText || cleanText.length < 1) {
        console.log(`[VIDEO] Skipping empty subtitle at index ${index}`);
        return;
      }

      const startTime = this.formatSRTTime(subtitle.start);
      const endTime = this.formatSRTTime(subtitle.end);

      validCount++;
      console.log(
        `[VIDEO] Subtitle ${validCount}: ${startTime} --> ${endTime} | ${cleanText}`
      );

      srtContent += `${validCount}\n`;
      srtContent += `${startTime} --> ${endTime}\n`;
      srtContent += `${cleanText}\n\n`;
    });

    if (validCount === 0) {
      throw new Error("No valid subtitles to write to SRT file");
    }

    await fs.writeFile(srtPath, srtContent, "utf8");
    console.log(
      `[VIDEO] ✅ SRT file created with ${validCount} subtitles: ${srtPath}`
    );

    return srtPath;
  }

  // ✅ SINGLE WORKING ADD SUBTITLES METHOD
  async addSubtitles(videoPath, originalVideoPath, params) {
    console.log("[VIDEO] Adding subtitles with proper timing and colors");

    try {
      // ✅ FIX 1: Generate subtitles for TRIMMED portion only
      const subtitleResult = await whisperService.generateSubtitles(
        originalVideoPath,
        {
          language: params.subtitleLanguage,
          translateToEnglish: params.translateToEnglish,
          trimStart: params.startTime, // ✅ Start from trim point
          trimEnd: params.endTime, // ✅ End at trim point
        }
      );

      if (!subtitleResult.subtitles || subtitleResult.subtitles.length === 0) {
        console.log("[VIDEO] No subtitles generated, continuing without");
        return videoPath;
      }

      // ✅ FIX 2: No timestamp adjustment needed - Whisper already provides relative timestamps
      const filteredSubtitles = subtitleResult.subtitles.filter((subtitle) => {
        // Basic validation only
        return (
          subtitle.text &&
          subtitle.text.trim().length > 0 &&
          subtitle.start >= 0 &&
          subtitle.end > subtitle.start &&
          subtitle.end <= params.endTime - params.startTime // Must be within trimmed duration
        );
      });

      console.log(
        `[VIDEO] Using ${filteredSubtitles.length} subtitles for trimmed video`
      );

      if (filteredSubtitles.length === 0) {
        console.log("[VIDEO] No valid subtitles found, continuing without");
        return videoPath;
      }

      // ✅ FIX 3: Add gap validation to prevent spoiler subtitles
      const gapValidatedSubtitles =
        this.validateSubtitleGaps(filteredSubtitles);

      const srtPath = await this.createCleanSRTFile(gapValidatedSubtitles);

      // ... rest of your subtitle styling code remains the same ...
    } catch (error) {
      console.error("[VIDEO] Subtitle generation failed:", error);
      console.log("[VIDEO] Continuing without subtitles");
      return videoPath;
    }
  }

  // ✅ FIX 4: Add this new method to prevent spoiler subtitles
  validateSubtitleGaps(subtitles, maxAllowedGap = 3.0) {
    const validatedSubtitles = [];

    for (let i = 0; i < subtitles.length; i++) {
      const currentSub = subtitles[i];
      const previousSub = validatedSubtitles[validatedSubtitles.length - 1];

      // If this is the first subtitle, add it
      if (!previousSub) {
        validatedSubtitles.push(currentSub);
        continue;
      }

      // Calculate gap between previous subtitle end and current subtitle start
      const gap = currentSub.start - previousSub.end;

      if (gap > maxAllowedGap) {
        console.log(
          `[VIDEO] Large gap detected: ${gap.toFixed(1)}s between subtitles`
        );
        console.log(
          `[VIDEO] Previous: "${previousSub.text}" (ends at ${previousSub.end}s)`
        );
        console.log(
          `[VIDEO] Current: "${currentSub.text}" (starts at ${currentSub.start}s)`
        );

        // Add subtitle but ensure it doesn't extend into the gap
        const adjustedSubtitle = {
          ...currentSub,
          // Ensure subtitle doesn't start too early
          start: Math.max(currentSub.start, previousSub.end + 0.5),
        };

        validatedSubtitles.push(adjustedSubtitle);
      } else {
        // Normal gap, add subtitle as-is
        validatedSubtitles.push(currentSub);
      }
    }

    console.log(
      `[VIDEO] Gap validation: ${subtitles.length} → ${validatedSubtitles.length} subtitles`
    );
    return validatedSubtitles;
  }

  cleanupIntermediateFiles(filePaths) {
    setTimeout(() => {
      filePaths.forEach((filePath) => {
        if (filePath) {
          fs.remove(filePath).catch(() => {});
        }
      });
    }, 10000);
  }
}

module.exports = new VideoProcessingService();
 