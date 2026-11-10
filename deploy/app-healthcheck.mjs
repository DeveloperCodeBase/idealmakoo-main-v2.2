try {
  // Compose passes the same protected budget used by Docker. Leave two seconds
  // for Node startup and process cleanup; changing only Docker's outer timeout
  // otherwise leaves a slow, healthy endpoint trapped behind a six-second abort.
  const selected = process.argv[2] ?? '8';
  if (!/^[1-9][0-9]{0,2}$/.test(selected)) throw new Error('Invalid health budget');
  const seconds = Number(selected);
  if (seconds < 8 || seconds > 120) throw new Error('Invalid health budget');
  const response = await fetch('http://127.0.0.1:3000/api/v1/health', {
    signal: AbortSignal.timeout((seconds - 2) * 1000), redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok || result.status !== 'ok') process.exitCode = 1;
} catch { process.exitCode = 1; }

