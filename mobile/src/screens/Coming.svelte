<script>
  // Placeholder for tiles built in the next phases
  import Icon from '../components/Icon.svelte';
  let { title, icon, onBack } = $props();
</script>

<main class="screen">
  <header class="topbar">
    <button class="icon-btn" type="button" onclick={onBack} aria-label="Back"><Icon name="back" size={24} /></button>
    <h2>{title}</h2>
    <span style="width:44px"></span>
  </header>
  <div class="empty big">
    <Icon name={icon} size={48} />
    <p>Coming in the next update.</p>
  </div>
</main>
