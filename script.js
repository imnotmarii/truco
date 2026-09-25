// CONFIGURAÇÃO DO SUPABASE
const SUPABASE_URL = 'https://xhqrksfotvjdsokeuglr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NG5cqeJjuzPOmb8nleOhbQ_heuUgGHm';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ESTADO LOCAL DO JOGO
let currentRoomCode = null;
let localPlayerId = null;
let realtimeChannel = null;

let gameState = {
  players: [], // [{ id, name, team, seat }]
  scoreA: 0,
  scoreB: 0,
  handValue: 1,
  currentTurn: 0,
  viraCard: null,
  tableCards: [],
  logs: []
};

// CRIAR A SALA NO BANCO DE DADOS
async function createGame() {
  const name = document.getElementById('player-name').value.trim();
  const team = document.getElementById('team-select').value;
  const roomCode = document.getElementById('room-code').value.trim().toUpperCase();

  if (!name || !roomCode) {
    alert('Preencha seu nome e o código da sala!');
    return;
  }

  currentRoomCode = roomCode;
  localPlayerId = 'player_' + Math.random().toString(36).substr(2, 9);

  const initialState = {
    ...gameState,
    players: [{ id: localPlayerId, name, team, seat: 0 }],
    logs: [`Sala criada por ${name}.`]
  };

  const { error } = await supabase
    .from('rooms')
    .upsert([{ code: roomCode, state: initialState }], { onConflict: 'code' });

  if (error) {
    console.error('Erro ao criar sala:', error);
    alert('Erro ao criar sala no Supabase. Verifique se criou a tabela no SQL Editor.');
    return;
  }

  subscribeToRoom(roomCode);
  showGameScreen();
}

// ENTRAR EM UMA SALA EXISTENTE
async function joinGame() {
  const name = document.getElementById('player-name').value.trim();
  const team = document.getElementById('team-select').value;
  const roomCode = document.getElementById('room-code').value.trim().toUpperCase();

  if (!name || !roomCode) {
    alert('Preencha seu nome e o código da sala!');
    return;
  }

  currentRoomCode = roomCode;
  localPlayerId = 'player_' + Math.random().toString(36).substr(2, 9);

  // Buscar estado atual da sala
  const { data: room, error } = await supabase
    .from('rooms')
    .select('state')
    .eq('code', roomCode)
    .single();

  if (error || !room) {
    alert('Sala não encontrada! Verifique o código digitado.');
    return;
  }

  let currentState = room.state || gameState;

  if (currentState.players.length >= 6) {
    alert('A sala já está cheia (máximo de 6 jogadoras)!');
    return;
  }

  const nextSeat = currentState.players.length;
  currentState.players.push({ id: localPlayerId, name, team, seat: nextSeat });
  currentState.logs.push(`${name} entrou na sala.`);

  // Atualizar a sala com a nova jogadora
  await supabase
    .from('rooms')
    .update({ state: currentState })
    .eq('code', roomCode);

  subscribeToRoom(roomCode);
  showGameScreen();
}

// ESCUTAR MUDANÇAS EM TEMPO REAL
function subscribeToRoom(roomCode) {
  realtimeChannel = supabase.channel(`room:${roomCode}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `code=eq.${roomCode}`
    }, (payload) => {
      gameState = payload.new.state;
      renderUI();
    })
    .subscribe();
}

// SINCRO COM A NUVEM
async function syncGameState() {
  if (!currentRoomCode) return;
  await supabase
    .from('rooms')
    .update({ state: gameState })
    .eq('code', currentRoomCode);
}

// AÇÕES DAS JOGADORAS
async function askTruco() {
  gameState.handValue = gameState.handValue === 1 ? 3 : gameState.handValue + 3;
  gameState.logs.push(`TRUCO pedido! Mão vale ${gameState.handValue} pts`);
  await syncGameState();
}

async function addBot() {
  if (gameState.players.length >= 6) {
    alert('Mesa cheia!');
    return;
  }
  const botSeat = gameState.players.length;
  const botTeam = botSeat % 2 === 0 ? 'A' : 'B';
  
  gameState.players.push({
    id: 'bot_' + Math.random().toString(36).substr(2, 5),
    name: `Bot ${botSeat + 1}`,
    team: botTeam,
    seat: botSeat
  });

  gameState.logs.push(`Bot ${botSeat + 1} adicionado ao Trio ${botTeam}`);
  await syncGameState();
}

async function resetMesa() {
  if (confirm('Deseja realmente sair da sala?')) {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
    }
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';
  }
}

// ATUALIZAR A TELA
function renderUI() {
  document.getElementById('score-a').innerText = gameState.scoreA || 0;
  document.getElementById('score-b').innerText = gameState.scoreB || 0;
  document.getElementById('hand-val').innerText = `${gameState.handValue || 1} pt`;

  // Atualiza as posições dos 6 assentos
  for (let i = 0; i < 6; i++) {
    const seatEl = document.getElementById(`info-${i}`);
    const player = gameState.players.find(p => p.seat === i);
    if (player) {
      seatEl.innerText = `${player.name} (${player.team})`;
    } else {
      seatEl.innerText = 'Vazio';
    }
  }

  // Atualizar histórico/log
  const logBox = document.getElementById('log');
  if (gameState.logs && gameState.logs.length > 0) {
    logBox.innerText = gameState.logs[gameState.logs.length - 1];
  }
}

function showGameScreen() {
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';
  renderUI();
}