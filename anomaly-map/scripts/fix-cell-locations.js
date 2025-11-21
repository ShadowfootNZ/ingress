// fix-cell-locations.js
import fs from "fs";
import path from "path";

const filePath = path.resolve("anomaly-map/data/anomalies.json");

// S2-style cell pattern: NR02-FOXTROT-11
const cellRegex = /^[A-Z0-9]{4}-[A-Z]+-\d+$/;

function isCellFormat(city) {
  return typeof city === "string" && cellRegex.test(city.trim());
}

function fixCellLocations() {
  let raw;

  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    console.error("❌ Unable to read anomalies.json:", e.message);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("❌ JSON parse error:", e.message);
    process.exit(1);
  }

  let count = 0;

  for (const a of data) {
    if (isCellFormat(a.city)) {
      if (a.location && (a.location.lat !== null || a.location.lng !== null)) {
        console.log(
          `→ Resetting location for cell-format city '${a.city}' ` +
            `(was lat=${a.location.lat}, lng=${a.location.lng})`
        );

        a.location.lat = null;
        a.location.lng = null;
        count++;
      }
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`\n✔ Done. Updated ${count} entries.`);
}

fixCellLocations();