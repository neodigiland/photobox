module.exports = {
  apps: [
    {
      name: 'photobox-backend',
      script: 'server.js',
      watch: true,
      ignore_watch: ['node_modules', 'galleries'],
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        MOCK_PRINTER: 'false',     // Set to 'true' for testing without a printer
        PRINTER_NAME: '',          // Leave empty for default printer, or e.g. 'Canon SELPHY CP1500'
        PAPER_SIZE: '4x6',        // Options: '2x6', '4x6', '5x7', 'A4', 'A5', 'A6', 'auto'
        PRINT_QUALITY: 'high',    // Options: 'high', 'normal', 'draft'
        COLOR_MODE: 'color',      // Options: 'color', 'grayscale'
        PORT: 3000
      }
    }
  ]
};
