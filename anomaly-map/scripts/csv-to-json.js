import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Paths relative to the script file, not the working directory
const inputPath = path.join(__dirname, "..", "data", "Stats.csv");
const outputPath = path.join(__dirname, "..", "data", "anomalies.json");

const csvRaw = fs.readFileSync(inputPath, "utf8");

// Parse CSV
const rows = parse(csvRaw, {
  columns: true,
  skip_empty_lines: true
});

// Convert each row → JSON object
const json = rows
  .filter(row => row.Type === "Modern Anomaly") // limit for now
  .map(row => {
    const enl = parseInt(row.ENL, 10) || 0;
    const res = parseInt(row.RES, 10) || 0;

    let winner = "tie";
    if (enl > res) winner = "enlightened";
    else if (res > enl) winner = "resistance";

    return {
      type: row.Type || "",
      series: row.Series || "",
      date: row.Date || "",               // YYYY-MM-DD format already good
      city: row.City || "",
      state: row["State/Region/Province"] || "",
      country: row.Country || "",
      location: { lat: null, lng: null }, // geocoder to fill this later
      score: { enl, res },
      winner,
      details: row.Details || "",
      info: row.Info || ""
    };
  });

// Save JSON
fs.writeFileSync(outputPath, JSON.stringify(json, null, 2), "utf8");

console.log(`✔ Converted ${json.length} anomalies → ${outputPath}`);