<script>
  // First use on a phone: customer ID, username and password (same as SiddhiGL Online)
  import { register } from '../lib/auth.js';

  let { onRegistered, notice = '' } = $props();

  let tenant = $state('');
  let username = $state('');
  let password = $state('');
  let deviceName = $state('My phone');
  let busy = $state(false);
  let error = $state('');

  const ready = $derived(tenant.trim() && username.trim() && password && !busy);

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    busy = true;
    error = '';
    try {
      const r = await register(tenant, username, password, deviceName);
      password = '';
      onRegistered(r);
    } catch (err) {
      error = err.message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen narrow">
  <header class="brand-head">
    <div class="logo">S</div>
    <h1>SiddhiGL Mobile</h1>
    <p class="muted">Log in once to set up this phone</p>
  </header>

  {#if notice}<p class="msg warn">{notice}</p>{/if}

  <form onsubmit={submit}>
    <label>
      Customer ID
      <input bind:value={tenant} autocapitalize="characters" autocomplete="organization" placeholder="e.g. SUPER" />
    </label>
    <label>
      Username
      <input bind:value={username} autocapitalize="none" autocomplete="username" />
    </label>
    <label>
      Password
      <input bind:value={password} type="password" autocomplete="current-password" />
    </label>
    <label>
      Phone name
      <input bind:value={deviceName} maxlength="60" />
      <small class="muted">Helps your admin tell your phones apart</small>
    </label>

    {#if error}<p class="msg error">{error}</p>{/if}

    <button class="primary" type="submit" disabled={!ready}>
      {busy ? 'Checking...' : 'Set up this phone'}
    </button>
  </form>
</main>
