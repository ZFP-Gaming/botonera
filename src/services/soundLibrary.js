const fs = require('fs');
const path = require('path');

const SOUND_FILE_REGEX = /\.(mp3|wav|ogg|flac)$/i;

function createSoundLibrary(dirs) {
  const soundDirs = dirs;

  function listSounds() {
    try {
      const seen = new Set();
      soundDirs.forEach((dir) => {
        try {
          fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
            if (!entry.isFile()) return;
            if (!SOUND_FILE_REGEX.test(entry.name)) return;
            if (!seen.has(entry.name)) {
              seen.add(entry.name);
            }
          });
        } catch (error) {
          console.error(`Error reading sounds directory ${dir}:`, error);
        }
      });
      return Array.from(seen).sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.error('Error reading sounds directories:', error);
      return [];
    }
  }

  function resolveSoundByName(name) {
    const safeName = path.basename(name);

    for (const dir of soundDirs) {
      const candidate = path.resolve(dir, safeName);
      const relative = path.relative(dir, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        continue;
      }
      if (fs.existsSync(candidate)) {
        return { name: safeName, path: candidate };
      }
    }
    return null;
  }

  return {
    listSounds,
    resolveSoundByName,
  };
}

module.exports = {
  createSoundLibrary,
  SOUND_FILE_REGEX,
};
