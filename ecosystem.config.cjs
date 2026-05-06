// PM2 process file. Single-process model: workers are async loops inside one node.
// PM2 just keeps the whole thing alive and restarts on crash.
// Uses Node 20's --env-file flag to load /opt/airadio/.env into process.env.
module.exports = {
  apps: [
    {
      name: 'airadio',
      script: 'server/index.js',
      cwd: __dirname,
      node_args: '--env-file=/opt/airadio/.env',
      instances: 1,
      exec_mode: 'fork',
      max_restarts: 999,
      restart_delay: 3000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
