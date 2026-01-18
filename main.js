const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Depending on if the HTML needs node features. Usually safer to be true, but for a quick wrapper of a local file, false might be needed if the HTML uses node. However, since the user said it was just an HTML file, it probably uses vanilla JS. I'll stick to defaults or enable if needed.
      // Given it's a "Toolkit" it might need file system access. 
      // If the HTML was designed for web, it uses <input type="file">.
      // If I wrap it in electron, standard web file APIs work.
      // I'll keep default security for now unless I see reasons to change.
      // Actually, standard web inputs are fine.
    }
  });

  win.loadFile('X-FMOD.html');
  
  // Remove menu bar if desired, or keep it.
  // win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
