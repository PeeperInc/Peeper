module.exports = {
  apps: [{
    name:        'peeper-backend',
    script:      'server.js',
    cwd:         '/var/www/peeper.frenzyradio.online/backend',
    instances:   1,
    autorestart: true,
    watch:       false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT:     4000,
    },
    error_file:  '/var/log/peeper/error.log',
    out_file:    '/var/log/peeper/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
