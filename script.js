// ==========================================
// CONFIGURAÇÃO E VARIÁVEIS GLOBAIS
// ==========================================
const SUPABASE_URL = 'https://xhqrksfotvjdsokeuglr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NG5cqeJjuzPOmb8nleOhbQ_heuUgGHm';

let supabaseClient = null;
let localPlayerId = null;
const SINGLE_ROOM_CODE = 'MESA_UNICA';
let realtimeChannel = null;

let gameState = {
  players: [],
  scoreA: 0,
  scoreB: 0,
  handValue: 1,
  logs: []
};

window.addEventListener('load', () => {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  const btnEnter = document.getElementById('btn-enter');
  if (btnEnter) btnEnter.onclick = enterRoom;

  const btnTruco = document.getElementById('btn-truco');
  if (btnTruco) btnTruco.onclick = askTruco;

  const btnBot = document.getElementById('btn-bot');
  if (btnBot) btnBot.onclick = addBot;

  const btnLeave = document.getElementById('btn-leave');
  if (btnLeave) btnLeave.onclick = leaveGame;
});

// ==========================================
// SAÍDA AUTOMÁTICA AO FECHAR A ABA / RECARREGAR
// ==========================================
window.addEventListener('beforeunload', () => {
  if (localPlayerId && gameState.players.length > 0) {
    // Remove o jogador local da lista
    gameState.players = gameState.players.filter(p => p.id !== localPlayerId);
    
    // Envia sincronização síncrona/rápida ao fechar a janela
    if (navigator.sendBeacon) {
      const payload = JSON.stringify({ state: gameState });
      const url = `${SUPABASE_URL}/rest/v1/rooms?code=eq.${SINGLE_ROOM_CODE}`;
      const headers = {
        'type': 'application/json',
        'endpoint': url
      };
      // Atualização em background
      fetch(url, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: payload,
        keepalive: true
      });
    }
  }
});

// ==========================================
// ENTRAR NA MESA DIRECTO
// ==========================================
async function enterRoom() {
  const nameInput = document.getElementById('player-name');
  const teamSelect = document.getElementById('team-select');

  const name = nameInput ? nameInput.value.trim() : '';
  const team = teamSelect ? teamSelect.value : 'A';

  if (!name) {
    alert('Por favor, digite o seu nome!');
    return;
  }

  // Gera um ID único por aba
  localPlayerId = 'player_' + Math.random().toString(36).substr(2, 9);

  try {
    let { data: room } = await supabaseClient
      .from('rooms')
      .select('state')
      .eq('code', SINGLE_ROOM_CODE)
      .maybeSingle();

    let currentState = (room && room.state) ? room.state : {
      players: [],
      scoreA: 0,
      scoreB: 0,
      handValue: 1,
      logs: ['Mesa iniciada.']
    };

    if (!currentState.players) currentState.players = [];

    // Trio A nas cadeiras 0, 2, 4 | Trio B nas cadeiras 1, 3, 5
    const allowedSeats = team === 'A' ? [0, 2, 4] : [1, 3, 5];
    const takenSeats = currentState.players.map(p => Number(p.seat));
    const availableSeat = allowedSeats.find(seat => !takenSeats.includes(seat));

    if (availableSeat === undefined) {
      alert(`O Trio ${team} já está cheio nesta mesa! Escolha o outro trio.`);
      return;
    }

    currentState.players.push({
      id: localPlayerId,
      name: name,
      team: team,
      seat: availableSeat
    });

    currentState.logs.push(`${name} entrou no Trio ${team}`);

    const { error: saveError } = await supabaseClient
      .from('rooms')
      .upsert({ code: SINGLE_ROOM_CODE, state: currentState }, { onConflict: 'code' });

    if (saveError) {
      alert("Erro ao conectar: " + saveError.message);
      return;
    }

    gameState = currentState;

    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';

    renderUI();
    subscribeToRoom();

  } catch (err) {
    console.error('Erro:', err);
    alert('Erro ao conectar na mesa.');
  }
}

// ==========================================
// TEMPO REAL (REALTIME)
// ==========================================
function subscribeToRoom() {
  if (!supabaseClient) return;

  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel('public_room')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'rooms',
        filter: `code=eq.${SINGLE_ROOM_CODE}`
      },
      (payload) => {
        if (payload.new && payload.new.state) {
          gameState = payload.new.state;
          renderUI();
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        fetchLatestState();
      }
    });
}

async function fetchLatestState() {
  if (!supabaseClient) return;
  const { data: room } = await supabaseClient
    .from('rooms')
    .select('state')
    .eq('code', SINGLE_ROOM_CODE)
    .maybeSingle();

  if (room && room.state) {
    gameState = room.state;
    renderUI();
  }
}

async function syncGameState() {
  if (!supabaseClient) return;
  await supabaseClient
    .from('rooms')
    .update({ state: gameState })
    .eq('code', SINGLE_ROOM_CODE);
}

// ==========================================
// AÇÕES DO JOGO
// ==========================================
async function askTruco() {
  gameState.handValue = gameState.handValue === 1 ? 3 : gameState.handValue + 3;
  gameState.logs.push(`TRUCO pedido! Mão vale ${gameState.handValue} pts`);
  renderUI();
  await syncGameState();
}

async function addBot() {
  if (gameState.players.length >= 6) {
    alert('Mesa cheia!');
    return;
  }

  const takenSeats = gameState.players.map(p => Number(p.seat));
  let botSeat = -1;
  let botTeam = 'A';

  for (let i = 0; i < 6; i++) {
    if (!takenSeats.includes(i)) {
      botSeat = i;
      botTeam = (i % 2 === 0) ? 'A' : 'B';
      break;
    }
  }

  if (botSeat !== -1) {
    gameState.players.push({
      id: 'bot_' + Math.random().toString(36).substr(2, 5),
      name: `Bot (${botTeam})`,
      team: botTeam,
      seat: botSeat
    });

    gameState.logs.push(`Bot adicionado`);
    renderUI();
    await syncGameState();
  }
}

async function leaveGame() {
  if (confirm('Deseja sair da mesa?')) {
    gameState.players = gameState.players.filter(p => p.id !== localPlayerId);
    gameState.logs.push(`Uma jogadora saiu da mesa.`);
    await syncGameState();

    if (realtimeChannel && supabaseClient) {
      supabaseClient.removeChannel(realtimeChannel);
    }

    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
  }
}

// ==========================================
// RENDERIZAÇÃO
// ==========================================
function renderUI() {
  const scoreA = document.getElementById('score-a');
  const scoreB = document.getElementById('score-b');
  const handVal = document.getElementById('hand-val');

  if (scoreA) scoreA.innerText = gameState.scoreA || 0;
  if (scoreB) scoreB.innerText = gameState.scoreB || 0;
  if (handVal) handVal.innerText = `${gameState.handValue || 1} pt`;

  // Reseta os lugares
  for (let i = 0; i < 6; i++) {
    const seatEl = document.getElementById(`info-${i}`);
    if (seatEl) {
      const defaultTeam = (i % 2 === 0) ? 'Trio A' : 'Trio B';
      seatEl.innerText = `Vazio (${defaultTeam})`;
    }
  }

  // Preenche quem está presente
  if (gameState.players && gameState.players.length > 0) {
    gameState.players.forEach(p => {
      const seatEl = document.getElementById(`info-${p.seat}`);
      if (seatEl) {
        seatEl.innerText = `${p.name} (${p.team})`;
      }
    });
  }

  const logBox = document.getElementById('log');
  if (logBox && gameState.logs && gameState.logs.length > 0) {
    logBox.innerText = gameState.logs[gameState.logs.length - 1];
  }
}