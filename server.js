const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs-extra");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

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

// Serve processed files
app.use("/processed-videos", express.static("processed"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Video Processor Server running on port ${PORT}`);
});
