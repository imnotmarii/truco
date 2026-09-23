// Gerenciador de Estado Local e Servidor Nuvens (com suporte a Broadcast entre abas)
let roomCode = "";
let mySeat = -1;
let myName = "";
let myTeam = "";

// Canal de comunicação instantâneo entre abas do mesmo navegador
let syncChannel = null;

// Função auxiliar de leitura de sala
function getLocalRoomData() {
  const data = localStorage.getItem(`truco_room_${roomCode}`);
  return data ? JSON.parse(data) : null;
}

function saveLocalRoomData(data) {
  localStorage.setItem(`truco_room_${roomCode}`, JSON.stringify(data));
  if (syncChannel) {
    syncChannel.postMessage(data);
  }
}

async function joinGame() {
  const roomInput = document.getElementById('room-code').value.trim().toUpperCase();
  const nameInput = document.getElementById('player-name').value.trim();
  const selectedTeam = document.getElementById('team-select').value;

  if (!roomInput) return alert("Por favor, digite o código da sala!");
  if (!nameInput) return alert("Por favor, digite o seu nome!");

  roomCode = roomInput;
  myName = nameInput;
  myTeam = selectedTeam;

  // Conecta ao canal de sincronização entre abas/dispositivos
  try {
    syncChannel = new BroadcastChannel(`truco_channel_${roomCode}`);
    syncChannel.onmessage = (event) => {
      renderGame(event.data);
    };
  } catch(e) {
    console.log("BroadcastChannel não suportado neste navegador.");
  }

  let room = getLocalRoomData() || { players: [], state: null, hands: {} };

  // Verifica se o jogador já estava na sala
  let existingPlayer = room.players.find(p => p.name === myName);

  if (existingPlayer) {
    mySeat = existingPlayer.seat;
    myTeam = existingPlayer.team;
  } else {
    if (room.players.length >= 6) {
      return alert("Esta sala já está cheia (6/6)!");
    }

    // Posições preferenciais por trio
    const teamAPositions = [0, 2, 4];
    const teamBPositions = [1, 3, 5];
    const preferredPositions = myTeam === 'A' ? teamAPositions : teamBPositions;
    const takenSeats = room.players.map(p => p.seat);

    mySeat = preferredPositions.find(seat => !takenSeats.includes(seat));

    if (mySeat === undefined) {
      mySeat = [0, 1, 2, 3, 4, 5].find(seat => !takenSeats.includes(seat));
      myTeam = (mySeat % 2 === 0) ? 'A' : 'B';
    }

    room.players.push({ name: myName, seat: mySeat, team: myTeam });
  }

  // Se completou 6 jogadores, inicia as cartas
  if (room.players.length === 6 && !room.state) {
    room = initHandData(room);
  }

  saveLocalRoomData(room);

  // Altera telas
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';

  // Renderiza imediatamente
  renderGame(room);

  // Inicia o relógio e atualização
  startPolling();
}

function initHandData(room) {
  const NAIPES = ['♦', '♠', '♥', '♣'];
  const VALORES = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
  let deck = [];

  for (let n of NAIPES) {
    for (let v of VALORES) {
      deck.push({ nome: v, naipe: n, isRed: (n === '♥' || n === '♦') });
    }
  }
  deck.sort(() => Math.random() - 0.5);

  const vira = deck.pop();
  let hands = {};

  for (let i = 0; i < 6; i++) {
    hands[i] = [deck.pop(), deck.pop(), deck.pop()];
  }

  room.hands = hands;
  room.state = {
    started: true,
    currentTurn: 0,
    handValue: 1,
    scoreA: 0,
    scoreB: 0,
    vira: vira,
    playedCards: [],
    turnStartTime: Date.now(),
    log: "Partida Iniciada! Boa sorte a todas!"
  };

  return room;
}

function addBot() {
  let room = getLocalRoomData();
  if (!room || room.players.length >= 6) return alert("Sala cheia!");

  const takenSeats = room.players.map(p => p.seat);
  const botSeat = [0, 1, 2, 3, 4, 5].find(s => !takenSeats.includes(s));
  const botTeam = (botSeat % 2 === 0) ? 'A' : 'B';

  room.players.push({ name: `Bot ${botSeat + 1}`, seat: botSeat, team: botTeam });

  if (room.players.length === 6 && !room.state) {
    room = initHandData(room);
  }

  saveLocalRoomData(room);
  renderGame(room);
}

function askTruco() {
  let room = getLocalRoomData();
  if (!room || !room.state || !room.state.started) return;

  if (room.state.handValue === 1) room.state.handValue = 3;
  else if (room.state.handValue === 3) room.state.handValue = 6;
  else if (room.state.handValue === 6) room.state.handValue = 9;
  else if (room.state.handValue === 9) room.state.handValue = 12;

  room.state.log = `🔥 TRUCO PEDIDO por ${myName}! A mão vale ${room.state.handValue} pts!`;
  saveLocalRoomData(room);
  renderGame(room);
}

function playCard(cardIdx) {
  let room = getLocalRoomData();
  if (!room || !room.state || room.state.currentTurn !== mySeat) {
    return alert("Aguarde a sua vez de jogar!");
  }

  executePlay(cardIdx, room);
}

function executePlay(cardIdx, room) {
  const currentSeat = room.state.currentTurn;
  const player = room.players.find(p => p.seat === currentSeat);

  if (!room.hands[currentSeat] || room.hands[currentSeat].length === 0) return;

  const card = room.hands[currentSeat].splice(cardIdx, 1)[0];
  room.state.playedCards.push({ card: card, seat: currentSeat });

  room.state.currentTurn = (room.state.currentTurn + 1) % 6;
  room.state.turnStartTime = Date.now();
  room.state.log = `${player ? player.name : 'Jogadora'} jogou ${card.nome}${card.naipe}`;

  saveLocalRoomData(room);
  renderGame(room);
}

function startPolling() {
  setInterval(() => {
    let room = getLocalRoomData();
    if (room) {
      renderGame(room);
    }
  }, 1000);
}

function renderGame(room) {
  if (!room) return;

  const players = room.players || [];
  const state = room.state;
  const hands = room.hands || {};

  // Cronômetro de 60 segundos
  if (state && state.started) {
    const elapsedSeconds = Math.floor((Date.now() - state.turnStartTime) / 1000);
    const remaining = Math.max(0, 60 - elapsedSeconds);

    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.innerText = remaining;

    // Jogada automática por estouro do tempo
    if (remaining === 0 && state.currentTurn === mySeat && hands[mySeat] && hands[mySeat].length > 0) {
      executePlay(0, room);
      return;
    }
  }

  // Atualiza as posições das jogadoras e os nomes no mapa da mesa
  for (let i = 0; i < 6; i++) {
    const info = document.getElementById(`info-${i}`);
    const cardsCont = document.getElementById(`cards-${i}`);

    const p = players.find(player => player.seat === i);

    if (p) {
      if (info) info.innerText = `${p.name} (${p.team})`;

      if (cardsCont) {
        cardsCont.innerHTML = '';
        if (state && state.started && hands[i]) {
          if (i === mySeat) {
            hands[i].forEach((card, idx) => {
              const c = document.createElement('div');
              c.className = `card ${card.isRed ? 'red' : ''}`;
              c.innerText = `${card.nome}${card.naipe}`;
              c.onclick = () => playCard(idx);
              cardsCont.appendChild(c);
            });
          } else {
            for (let c = 0; c < hands[i].length; c++) {
              const back = document.createElement('div');
              back.className = 'card-back';
              cardsCont.appendChild(back);
            }
          }
        }
      }
    } else {
      if (info) info.innerText = 'Vazio';
      if (cardsCont) cardsCont.innerHTML = '';
    }
  }

  // Atualiza o placar e mesa
  if (state) {
    const scoreAEl = document.getElementById('score-a');
    const scoreBEl = document.getElementById('score-b');
    const handValEl = document.getElementById('hand-val');
    const logEl = document.getElementById('log');

    if (scoreAEl) scoreAEl.innerText = state.scoreA || 0;
    if (scoreBEl) scoreBEl.innerText = state.scoreB || 0;
    if (handValEl) handValEl.innerText = `${state.handValue} pt${state.handValue > 1 ? 's' : ''}`;
    if (logEl) logEl.innerText = state.log;

    const viraSlot = document.getElementById('vira-card-slot');
    if (viraSlot && state.vira) {
      viraSlot.innerHTML = `<div class="card ${state.vira.isRed ? 'red' : ''}" style="cursor:default;">${state.vira.nome}${state.vira.naipe}</div>`;
    }

    const mat = document.getElementById('center-mat');
    if (mat) {
      mat.innerHTML = '';
      (state.playedCards || []).forEach(item => {
        const c = document.createElement('div');
        c.className = `card played ${item.card.isRed ? 'red' : ''}`;
        c.innerText = `${item.card.nome}${item.card.naipe}`;
        mat.appendChild(c);
      });
    }

    // Destaque de quem é a vez
    for (let i = 0; i < 6; i++) {
      const info = document.getElementById(`info-${i}`);
      if (info) {
        if (i === state.currentTurn) info.classList.add('active-turn');
        else info.classList.remove('active-turn');
      }
    }
  }
}

function resetMesa() {
  if (roomCode) {
    localStorage.removeItem(`truco_room_${roomCode}`);
  }
  location.reload();
}