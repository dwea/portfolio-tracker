module.exports = {
  apps: [
    {
      name: 'portfolio-tracker',
      script: 'server.js',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      cwd: __dirname,
      cron_restart: '0 3 * * *',
      autorestart: true,
    },
  ],
};
