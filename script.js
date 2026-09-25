// ==========================================
// 1. CONFIGURAÇÃO E VARIÁVEIS GLOBAIS
// ==========================================
const SUPABASE_URL = 'https://xhqrksfotvjdsokeuglr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NG5cqeJjuzPOmb8nleOhbQ_heuUgGHm';
const MAIN_ROOM_CODE = "MESA_PRINCIPAL";

let supabaseClient = null;
let localPlayerId = null;
let realtimeChannel = null;

let gameState = {
  players: [], // [{ id, name, team, seat }]
  scoreA: 0,
  scoreB: 0,
  handValue: 1,
  logs: []
};

// ==========================================
// 2. INICIALIZAÇÃO
// ==========================================
window.addEventListener('load', () => {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    console.error("Biblioteca Supabase não foi carregada no HTML.");
  }

  // Eventos dos Botões
  const btnEnter = document.getElementById('btn-enter');
  if (btnEnter) btnEnter.onclick = enterGame;

  const btnTruco = document.getElementById('btn-truco');
  if (btnTruco) btnTruco.onclick = askTruco;

  const btnBot = document.getElementById('btn-bot');
  if (btnBot) btnBot.onclick = addBot;

  const btnLeave = document.getElementById('btn-leave');
  if (btnLeave) btnLeave.onclick = leaveGame;
});

// ==========================================
// 3. ENTRAR NA MESA (SINCRONIZADO)
// ==========================================
async function enterGame() {
  const nameInput = document.getElementById('player-name');
  const teamSelect = document.getElementById('team-select');

  const name = nameInput ? nameInput.value.trim() : '';
  const team = teamSelect ? teamSelect.value : 'A';

  if (!name) {
    alert('Por favor, digite seu nome!');
    return;
  }

  localPlayerId = 'player_' + Math.random().toString(36).substr(2, 9);

  if (!supabaseClient) {
    alert("Servidor desconectado. Verifique sua conexão com o Supabase.");
    return;
  }

  try {
    // Busca os dados atualizados da mesa no Supabase antes de sentar
    let { data: room } = await supabaseClient
      .from('rooms')
      .select('state')
      .eq('code', MAIN_ROOM_CODE)
      .maybeSingle();

    let currentState = (room && room.state) ? room.state : {
      players: [],
      scoreA: 0,
      scoreB: 0,
      handValue: 1,
      logs: ['Mesa iniciada.']
    };

    if (!currentState.players) currentState.players = [];

    // Intercala as posições: Trio A pega (0, 2, 4) | Trio B pega (1, 3, 5)
    const allowedSeats = team === 'A' ? [0, 2, 4] : [1, 3, 5];
    const takenSeats = currentState.players.map(p => p.seat);
    const availableSeat = allowedSeats.find(seat => !takenSeats.includes(seat));

    if (availableSeat === undefined) {
      alert(`O Trio ${team} já está cheio! Escolha o outro trio.`);
      return;
    }

    // Adiciona a jogadora no estado atualizado
    currentState.players.push({
      id: localPlayerId,
      name: name,
      team: team,
      seat: availableSeat
    });

    currentState.logs.push(`${name} entrou no Trio ${team} (Cadeira ${availableSeat + 1})`);

    // Salva o novo estado na nuvem
    const { error: saveError } = await supabaseClient
      .from('rooms')
      .upsert([{ code: MAIN_ROOM_CODE, state: currentState }], { onConflict: 'code' });

    if (saveError) {
      alert("Erro ao salvar no banco: " + saveError.message);
      return;
    }

    // Atualiza a tela local e conecta ao Realtime
    gameState = currentState;
    showGameScreen();
    subscribeToRoom();

  } catch (err) {
    console.error('Erro de conexão:', err);
    alert('Erro de conexão ao tentar entrar na mesa.');
  }
}

// ==========================================
// 4. ESCUTAR MUDANÇAS EM TEMPO REAL
// ==========================================
function subscribeToRoom() {
  if (!supabaseClient) return;

  // Evita múltiplas conexões acumuladas
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient.channel(`room:${MAIN_ROOM_CODE}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `code=eq.${MAIN_ROOM_CODE}`
    }, (payload) => {
      if (payload.new && payload.new.state) {
        gameState = payload.new.state;
        renderUI();
      }
    })
    .subscribe();
}

async function syncGameState() {
  if (!supabaseClient) return;
  await supabaseClient
    .from('rooms')
    .update({ state: gameState })
    .eq('code', MAIN_ROOM_CODE);
}

// ==========================================
// 5. AÇÕES DA MESA
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

  const takenSeats = gameState.players.map(p => p.seat);
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

    gameState.logs.push(`Bot adicionado na Cadeira ${botSeat + 1} (${botTeam})`);
    renderUI();
    await syncGameState();
  }
}

async function leaveGame() {
  if (confirm('Deseja sair da mesa?')) {
    gameState.players = gameState.players.filter(p => p.id !== localPlayerId);
    renderUI();
    await syncGameState();

    if (realtimeChannel && supabaseClient) {
      supabaseClient.removeChannel(realtimeChannel);
    }

    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
  }
}

// ==========================================
// 6. RENDERIZAÇÃO DA INTERFACE (UI)
// ==========================================
function renderUI() {
  const scoreA = document.getElementById('score-a');
  const scoreB = document.getElementById('score-b');
  const handVal = document.getElementById('hand-val');

  if (scoreA) scoreA.innerText = gameState.scoreA || 0;
  if (scoreB) scoreB.innerText = gameState.scoreB || 0;
  if (handVal) handVal.innerText = `${gameState.handValue || 1} pt`;

  // Atualiza as 6 posições intercaladas
  for (let i = 0; i < 6; i++) {
    const seatEl = document.getElementById(`info-${i}`);
    if (seatEl) {
      const player = gameState.players ? gameState.players.find(p => p.seat === i) : null;
      const teamLabel = (i % 2 === 0) ? 'Trio A' : 'Trio B';
      seatEl.innerText = player ? `${player.name} (${player.team})` : `Vazio (${teamLabel})`;
    }
  }

  // Atualiza o histórico de mensagens
  const logBox = document.getElementById('log');
  if (logBox && gameState.logs && gameState.logs.length > 0) {
    logBox.innerText = gameState.logs[gameState.logs.length - 1];
  }
}

function showGameScreen() {
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';
  renderUI();
}