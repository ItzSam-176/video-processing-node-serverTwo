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
      // ✅ FIX 1: Generate subtitles for ORIGINAL video (not trimmed)
      // This ensures timing is correct
      const subtitleResult = await whisperService.generateSubtitles(
        originalVideoPath,
        {
          language: params.subtitleLanguage,
          translateToEnglish: params.translateToEnglish,
          trimStart: 0, // ✅ Always use full video for subtitle generation
          trimEnd: null, // ✅ Process entire video
        }
      );

      if (!subtitleResult.subtitles || subtitleResult.subtitles.length === 0) {
        console.log("[VIDEO] No subtitles generated, continuing without");
        return videoPath;
      }

      // ✅ FIX 2: Filter subtitles to match trimmed video timeframe
      const filteredSubtitles = subtitleResult.subtitles
        .map((subtitle) => ({
          ...subtitle,
          start: subtitle.start - params.startTime, // Adjust timing for trimmed video
          end: subtitle.end - params.startTime,
        }))
        .filter(
          (subtitle) =>
            subtitle.start >= 0 && // Must start after trim start
            subtitle.start < params.endTime - params.startTime && // Must be within trimmed duration
            subtitle.end > 0 // Must have positive duration
        );

      console.log(
        `[VIDEO] Filtered ${filteredSubtitles.length} subtitles for trimmed video`
      );

      if (filteredSubtitles.length === 0) {
        console.log(
          "[VIDEO] No subtitles in trimmed range, continuing without"
        );
        return videoPath;
      }

      const srtPath = await this.createCleanSRTFile(filteredSubtitles);
      const outputPath = path.join(
        __dirname,
        "../temp",
        `with_subtitles_${uuidv4()}.mp4`
      );

      /// ✅ SINGLE, COMPLETE STYLING LOGIC
      let subtitleStyle;

      console.log(`[VIDEO] Using subtitle color: ${params.subtitleColor}`);
      console.log(
        `[VIDEO] Using subtitle background: ${params.subtitleBgColor}`
      );

      if (params.subtitleBgColor === "black") {
        // Black background with colored text
        if (params.subtitleColor === "#FF0000") {
          console.log(
            `[FONT COLOR] Using red subtitle color with black background`
          );
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&H000000FF,BackColour=&H80000000,BorderStyle=4,Outline=0,Alignment=2,MarginV=40`;
        } else if (params.subtitleColor === "#FFFF00") {
          console.log(`[FONT COLOR] Using yellow subtitle color`);
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&H0000FFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Alignment=2,MarginV=40`;
        } else if (params.subtitleColor === "#00FF00") {
          console.log(`[FONT COLOR] Using green subtitle color`);
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&H0000FF00,BackColour=&H80000000,BorderStyle=4,Outline=0,Alignment=2,MarginV=40`;
        } else if (params.subtitleColor === "#0099FF") {
          console.log(
            `[FONT COLOR] Using blue subtitle style with black background`
          );
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&H00FF9900,BackColour=&H80000000,BorderStyle=4,Outline=0,Alignment=2,MarginV=40`;
        } else {
          console.log(
            `[FONT COLOR] Using default white subtitle style with black background`
          );
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&HFFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Alignment=2,MarginV=40`;
        }
      } else {
        // No background - outline only
        if (params.subtitleColor === "#FF0000") {
          console.log(`[FONT COLOR] Using red subtitle color with outline`);
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&H000000FF,OutlineColour=&H000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=40`;
        } else if (params.subtitleColor === "#FFFF00") {
          console.log(`[FONT COLOR] Using yellow subtitle color`);
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&H0000FFFF,OutlineColour=&H000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=40`;
        } else if (params.subtitleColor === "#00FF00") {
          console.log(`[FONT COLOR] Using green subtitle color`);
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&H0000FF00,OutlineColour=&H000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=40`;
        } else if (params.subtitleColor === "#0099FF") {
          console.log(`[FONT COLOR] Using blue subtitle style with outline`);
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&H00FF9900,OutlineColour=&H000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=40`;
        } else {
          console.log(
            `[FONT COLOR] Using default white subtitle style with outline`
          );
          subtitleStyle = `FontName=Arial,FontSize=${
            params.subtitleFontSize || 24
          },PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=40`;
        }
      }

      console.log(`[VIDEO] Final subtitle style: ${subtitleStyle}`);

      // ❌ MAKE SURE THERE IS NO MORE ASSIGNMENT TO subtitleStyle AFTER THIS POINT

      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .videoFilters([
            `subtitles=${srtPath.replace(
              /\\/g,
              "/"
            )}:force_style='${subtitleStyle}'`,
          ])
          .videoCodec("libx264")
          .audioCodec("copy")
          .outputOptions(["-preset", "fast", "-crf", "23"])
          .output(outputPath)
          .on("start", (cmd) => {
            console.log("[VIDEO] FFmpeg subtitle command:", cmd);
          })
          .on("end", () => {
            console.log("[VIDEO] Subtitles added successfully");
            setTimeout(() => fs.remove(srtPath).catch(() => {}), 30000);
            resolve(outputPath);
          })
          .on("error", (error) => {
            console.error("[VIDEO] Subtitle addition failed:", error);
            fs.remove(srtPath).catch(() => {});
            console.log("[VIDEO] Continuing without subtitles");
            resolve(videoPath);
          })
          .run();
      });
    } catch (error) {
      console.error("[VIDEO] Subtitle generation failed:", error);
      console.log("[VIDEO] Continuing without subtitles");
      return videoPath;
    }
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
 