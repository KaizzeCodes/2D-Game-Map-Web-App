const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Paths
const mapsDir = path.join(__dirname, "maps");
const globalConfigPath = path.join(__dirname, "global.json");

// Ensure /maps directory exists
if (!fs.existsSync(mapsDir)) {
  fs.mkdirSync(mapsDir);
}

// Ensure global.json exists
if (!fs.existsSync(globalConfigPath)) {
  fs.writeFileSync(globalConfigPath, JSON.stringify({ mapOrder: [] }, null, 2));
}

// Multer storage in memory
const upload = multer({ storage: multer.memoryStorage() });

// -----------------------------
// Helpers
// -----------------------------
function getMapPath(name) {
  return path.join(mapsDir, name);
}

function getLayoutPath(name) {
  return path.join(getMapPath(name), "layout.json");
}

function ensureMapDir(name, cb) {
  const dir = getMapPath(name);
  if (!fs.existsSync(dir)) {
    fs.mkdir(dir, cb);
  } else {
    cb(null);
  }
}

function readGlobalConfig() {
  try {
    const data = fs.readFileSync(globalConfigPath, "utf8");
    return JSON.parse(data);
  } catch {
    return { mapOrder: [] };
  }
}

function writeGlobalConfig(cfg) {
  fs.writeFileSync(globalConfigPath, JSON.stringify(cfg, null, 2));
}

// -----------------------------
// API: Get list of map folders (ordered)
// -----------------------------
app.get("/api/maps", (req, res) => {
  fs.readdir(mapsDir, { withFileTypes: true }, (err, files) => {
    if (err) return res.status(500).json({ error: "Failed to read maps directory" });

    const folders = files.filter(f => f.isDirectory()).map(f => f.name);

    const cfg = readGlobalConfig();
    let order = cfg.mapOrder || [];

    // Remove orphaned entries
    order = order.filter(name => folders.includes(name));

    // Append any new folders not in order
    const remaining = folders.filter(name => !order.includes(name));
    order = order.concat(remaining);

    cfg.mapOrder = order;
    writeGlobalConfig(cfg);

    res.json({ maps: order });
  });
});

// -----------------------------
// API: Create a new map folder
// -----------------------------
app.post("/api/maps", (req, res) => {
  const name = req.body.name;

  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Invalid map name" });
  }

  const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
  if (!safeName) {
    return res.status(400).json({ error: "Invalid sanitized name" });
  }

  const folderPath = getMapPath(safeName);

  if (fs.existsSync(folderPath)) {
    return res.status(400).json({ error: "Map already exists" });
  }

  fs.mkdir(folderPath, err => {
    if (err) return res.status(500).json({ error: "Failed to create folder" });

    const layout = {
      images: [],
      zoom: 0.125,
      panX: 0,
      panY: 0
    };

    fs.writeFile(getLayoutPath(safeName), JSON.stringify(layout, null, 2), err2 => {
      if (err2) return res.status(500).json({ error: "Failed to create layout" });

      const cfg = readGlobalConfig();
      if (!cfg.mapOrder.includes(safeName)) {
        cfg.mapOrder.push(safeName);
        writeGlobalConfig(cfg);
      }

      res.json({ success: true, name: safeName });
    });
  });
});

// -----------------------------
// API: Delete a map folder
// -----------------------------
app.delete("/api/maps/:name", (req, res) => {
  const name = req.params.name;
  const folderPath = getMapPath(name);

  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: "Map not found" });
  }

  fs.rm(folderPath, { recursive: true, force: true }, err => {
    if (err) return res.status(500).json({ error: "Failed to delete folder" });

    const cfg = readGlobalConfig();
    cfg.mapOrder = (cfg.mapOrder || []).filter(n => n !== name);
    writeGlobalConfig(cfg);

    res.json({ success: true });
  });
});

// -----------------------------
// API: Upload image to a map
// -----------------------------
app.post("/api/maps/:name/upload", upload.single("file"), (req, res) => {
  const name = req.params.name;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  ensureMapDir(name, err => {
    if (err) return res.status(500).json({ error: "Failed to ensure map directory" });

    const dir = getMapPath(name);

    fs.readdir(dir, (err2, files) => {
      if (err2) return res.status(500).json({ error: "Failed to read map directory" });

      let maxIndex = 0;
      files.forEach(f => {
        const match = f.match(/^img_(\d+)\./);
        if (match) {
          const idx = parseInt(match[1], 10);
          if (idx > maxIndex) maxIndex = idx;
        }
      });

      const nextIndex = maxIndex + 1;
      const ext = path.extname(file.originalname) || ".png";
      const filename = `img_${String(nextIndex).padStart(3, "0")}${ext}`;
      const fullPath = path.join(dir, filename);

      fs.writeFile(fullPath, file.buffer, err3 => {
        if (err3) return res.status(500).json({ error: "Failed to save image" });
        res.json({ success: true, file: filename });
      });
    });
  });
});

// -----------------------------
// API: Get layout.json for a map
// -----------------------------
app.get("/api/maps/:name/layout", (req, res) => {
  const name = req.params.name;
  const layoutPath = getLayoutPath(name);

  if (!fs.existsSync(layoutPath)) {
    const layout = {
      images: [],
      zoom: 0.125,
      panX: 0,
      panY: 0
    };
    return res.json(layout);
  }

  fs.readFile(layoutPath, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Failed to read layout" });

    try {
      const layout = JSON.parse(data);
      res.json(layout);
    } catch {
      return res.status(500).json({ error: "Invalid layout JSON" });
    }
  });
});

// -----------------------------
// API: Save layout.json for a map
// -----------------------------
app.post("/api/maps/:name/layout", (req, res) => {
  const name = req.params.name;
  const layoutPath = getLayoutPath(name);

  const layout = req.body;
  if (!layout || typeof layout !== "object") {
    return res.status(400).json({ error: "Invalid layout" });
  }

  ensureMapDir(name, err => {
    if (err) return res.status(500).json({ error: "Failed to ensure map directory" });

    fs.writeFile(layoutPath, JSON.stringify(layout, null, 2), err2 => {
      if (err2) return res.status(500).json({ error: "Failed to save layout" });
      res.json({ success: true });
    });
  });
});

// -----------------------------
// API: Update global map order
// -----------------------------
app.post("/api/global/mapOrder", (req, res) => {
  const order = req.body.mapOrder;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "mapOrder must be an array" });
  }

  fs.readdir(mapsDir, { withFileTypes: true }, (err, files) => {
    if (err) return res.status(500).json({ error: "Failed to read maps directory" });

    const folders = files.filter(f => f.isDirectory()).map(f => f.name);

    const filtered = order.filter(name => folders.includes(name));
    const remaining = folders.filter(name => !filtered.includes(name));
    const finalOrder = filtered.concat(remaining);

    const cfg = readGlobalConfig();
    cfg.mapOrder = finalOrder;
    writeGlobalConfig(cfg);

    res.json({ success: true });
  });
});

// -----------------------------
// Start server
// -----------------------------
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
