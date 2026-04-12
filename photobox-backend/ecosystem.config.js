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
        MOCK_PRINTER: 'true', // Set to false when SumatraPDF and real printer are installed
        PORT: 3000
      }
    }
  ]
};
