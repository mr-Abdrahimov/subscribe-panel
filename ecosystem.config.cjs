module.exports = {
  apps: [
    {
      name: 'subscribe-backend',
      cwd: '/var/www/subscribe-panel/backend',
      script: 'npm',
      args: 'run start:prod',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
    },
    {
      name: 'subscribe-frontend',
      cwd: '/var/www/subscribe-panel/frontend',
      script: 'npm',
      args: 'run preview -- --host 0.0.0.0 --port 3001',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
    },
  ],
};

