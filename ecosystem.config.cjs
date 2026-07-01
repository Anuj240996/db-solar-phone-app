/**
 * PM2: keep API running after SSH exit, restart on crash, optional start on reboot.
 *
 * On VPS:
 *   cd /home/anujdeshmukh24/dbsolar_app/backend
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 *   (run the command pm2 startup prints once)
 *
 * Stop manually: pm2 stop dbsolar-api
 * Logs: pm2 logs dbsolar-api
 */
module.exports = {
  apps: [
    {
      name: 'dbsolar-api',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      // Restart if it exits for any reason (crash, OOM, etc.)
      min_uptime: '10s',
      max_restarts: 50,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
