<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface NodeData {
    sensor_value: number;
    temperature: number;
    rssi: number;
    hops: number;
    _time: string;
    variance: number;
  }

  interface AlertData {
    delta: number;
    active: boolean;
    _time: string;
  }

  let nodeData: Record<string, NodeData> = {};
  let activeAlerts: Record<string, AlertData> = {};
  let loading = true;
  let lastUpdate = '';
  let pollInterval: ReturnType<typeof setInterval>;

  async function fetchData() {
    try {
      const res = await fetch('/api/allData');
      const { sensorData, alertData, timestamp } = await res.json();

      nodeData = sensorData;
      activeAlerts = alertData;
      lastUpdate = timestamp;
      loading = false;
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
  }

  onMount(() => {
    fetchData();
    pollInterval = setInterval(fetchData, 3000);
  });

  onDestroy(() => clearInterval(pollInterval));
</script>

<div class="min-h-screen bg-gradient-to-br from-sky-100 via-blue-200 to-indigo-300 flex flex-col items-center px-6 py-10">

  <!-- Title -->
  <div class="text-center mb-8">
    <h1 class="text-4xl font-extrabold bg-gradient-to-r from-cyan-500 via-blue-600 to-purple-600 bg-clip-text text-transparent drop-shadow-md">
      SpikeStop Dashboard
    </h1>
    <p class="text-gray-600 mt-2 text-sm italic">Live IoT sensor feed with alert detection</p>
  </div>

  <!-- Timestamp -->
  {#if !loading}
    <p class="text-gray-500 text-sm mb-6">Last updated: {new Date(lastUpdate).toLocaleTimeString()}</p>
  {/if}

  <!-- Loader -->
  {#if loading}
    <div class="flex items-center justify-center h-64">
      <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if Object.keys(nodeData).length === 0}
    <p class="text-gray-600 text-center mt-12">No active cups detected</p>
  {:else}
    <!-- Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 w-full max-w-7xl">
      {#each Object.keys(nodeData) as mac}
        <div
          class="relative rounded-3xl p-6 border backdrop-blur-lg shadow-xl overflow-hidden transition-all duration-500 hover:scale-[1.03] hover:shadow-2xl
            bg-white/40 border-white/30"
          class:ring-4={activeAlerts[mac]?.active}
          class:ring-red-500={activeAlerts[mac]?.active}
        >
          <!-- Cup graphic -->
          <div class="flex justify-center mb-4">
            <div
              class="relative w-24 h-36 bg-gradient-to-t from-blue-300 to-blue-100 rounded-b-full border-4 border-blue-200 overflow-hidden shadow-inner">
              <div
                class="absolute bottom-0 left-0 w-full transition-all duration-700 ease-out"
                style="height: {Math.min(nodeData[mac].sensor_value / 100, 1) * 100}%; background: linear-gradient(to top, #60a5fa, #93c5fd); border-top: 2px solid rgba(255,255,255,0.6)">
              </div>
              <div
                class="absolute inset-0 rounded-b-full bg-white/10 backdrop-blur-sm mix-blend-overlay pointer-events-none">
              </div>
            </div>
          </div>

          <!-- MAC -->
          <h2 class="text-center font-semibold text-gray-700 text-sm mb-2 truncate">{mac}</h2>

          <!-- Readings -->
          <div class="grid grid-cols-2 gap-3 text-center">
            <div class="bg-blue-50/60 rounded-xl py-2">
              <p class="text-xs text-gray-500"> Temp</p>
              <p class="font-semibold text-blue-600">{nodeData[mac].temperature}°C</p>
            </div>

            <div class="bg-green-50/60 rounded-xl py-2">
              <p class="text-xs text-gray-500"> Turbidity</p>
              <p class="font-semibold text-green-600">{nodeData[mac].sensor_value}</p>
            </div>

            <div class="col-span-2 bg-purple-50/60 rounded-xl py-2">
              <p class="text-xs text-gray-500"> Variance</p>
              <p class={nodeData[mac].variance > 50 ? 'text-red-600 font-bold' : 'text-purple-600 font-semibold'}>
                {nodeData[mac].variance.toFixed(1)}
              </p>
            </div>
          </div>

          <!-- Bottom Info -->
          <div class="mt-4 flex justify-between text-xs text-gray-600">
            <span> {nodeData[mac].rssi} dB</span>
            <span> {nodeData[mac].hops} hops</span>
          </div>

          <!-- Active Alert Glow styling --> 

          {#if activeAlerts[mac]?.active}
            <div class="absolute inset-0 bg-red-500/10 animate-pulse rounded-3xl pointer-events-none"></div>
            <div class="absolute top-3 right-3 text-xs bg-red-500 text-white px-2 py-1 rounded-full shadow animate-pulse">
              ⚠ Δ{activeAlerts[mac].delta.toFixed(1)}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
