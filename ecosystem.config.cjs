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
      args: 'run start:prod',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3001',
        NITRO_HOST: '0.0.0.0',
        NITRO_PORT: '3001',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
    },
  ],
};

