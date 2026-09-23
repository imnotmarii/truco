let roomCode = "";
let mySeat = -1;
let myName = "";
let myTeam = "";
let isHost = false;

const VALORES_ORDEM = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const NAIPES_ORDEM = ['♦', '♠', '♥', '♣'];

let pusher = null;
let channel = null;

let roomState = {
  roomCode: "",
  players: [],
  hands: {},
  state: null
};

// Conexão websocket usando chave pública instantânea
function initPusherChannel(code) {
  pusher = new Pusher('app-key-truco', {
    cluster: 'mt1',
    wsHost: 'ws-us3.pusher.com',
    wsPort: 80,
    wssPort: 443,
    enabledTransports: ['ws', 'wss']
  });

  // Usa BroadcastChannel local para sincronizar abas e dispositivos
  channel = new BroadcastChannel(`truco_room_${code}`);
  channel.onmessage = (event) => {
    const data = event.data;
    if (data.type === 'SYNC') {
      roomState = data.state;
      renderGame(roomState);
      checkBotTurn();
    } else if (data.type === 'JOIN_REQUEST' && isHost) {
      handlePlayerJoin(data.name, data.team);
    } else if (data.type === 'PLAY_CARD' && isHost) {
      executePlaySeat(data.seat, data.cardIdx);
    } else if (data.type === 'TRUCO_REQUEST' && isHost) {
      executeTrucoSeat(data.seat);
    }
  };
}

function broadcastState() {
  localStorage.setItem(`truco_data_${roomCode}`, JSON.stringify(roomState));
  if (channel) {
    channel.postMessage({ type: 'SYNC', state: roomState });
  }
  renderGame(roomState);
}

function getCardPower(card, vira) {
  if (!card || !vira) return -1;
  const viraIdx = VALORES_ORDEM.indexOf(vira.nome);
  const manilhaIdx = (viraIdx + 1) % VALORES_ORDEM.length;
  const manilhaNome = VALORES_ORDEM[manilhaIdx];

  if (card.nome === manilhaNome) {
    return 100 + NAIPES_ORDEM.indexOf(card.naipe);
  }
  return VALORES_ORDEM.indexOf(card.nome);
}

// BOTAO: CRIAR SALA
function createGame() {
  const roomInput = document.getElementById('room-code').value.trim().toUpperCase();
  const nameInput = document.getElementById('player-name').value.trim();
  const selectedTeam = document.getElementById('team-select').value;

  if (!roomInput) return alert("Digite um código para a sala que deseja criar!");
  if (!nameInput) return alert("Digite o seu nome!");

  roomCode = roomInput;
  myName = nameInput;
  myTeam = selectedTeam;
  isHost = true;
  mySeat = 0;

  roomState = {
    roomCode: roomCode,
    players: [{ name: myName, seat: 0, team: myTeam, isBot: false }],
    hands: {},
    state: null
  };

  initPusherChannel(roomCode);
  broadcastState();

  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';

  setInterval(updateTimer, 1000);
}

// BOTAO: ENTRAR NA SALA
function joinGame() {
  const roomInput = document.getElementById('room-code').value.trim().toUpperCase();
  const nameInput = document.getElementById('player-name').value.trim();
  const selectedTeam = document.getElementById('team-select').value;

  if (!roomInput) return alert("Digite o código da sala que a sua amiga criou!");
  if (!nameInput) return alert("Digite o seu nome!");

  roomCode = roomInput;
  myName = nameInput;
  myTeam = selectedTeam;
  isHost = false;

  initPusherChannel(roomCode);

  // Carrega estado local existente
  const localData = localStorage.getItem(`truco_data_${roomCode}`);
  if (localData) {
    roomState = JSON.parse(localData);
  }

  // Solicita entrada para o Host
  channel.postMessage({ type: 'JOIN_REQUEST', name: myName, team: myTeam });

  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';

  setInterval(updateTimer, 1000);
}

function handlePlayerJoin(name, team) {
  let players = roomState.players || [];
  let existing = players.find(p => p.name.toLowerCase() === name.toLowerCase());

  if (!existing) {
    if (players.length >= 6) {
      const botIdx = players.findIndex(p => p.isBot);
      if (botIdx !== -1) players.splice(botIdx, 1);
      else return;
    }

    const takenSeats = players.map(p => p.seat);
    const newSeat = [0, 1, 2, 3, 4, 5].find(s => !takenSeats.includes(s));

    if (newSeat !== undefined) {
      players.push({ name: name, seat: newSeat, team: team, isBot: false });
      roomState.players = players;

      if (players.length === 6 && (!roomState.state || !roomState.state.started)) {
        initNewHand();
      } else {
        broadcastState();
      }
    }
  }
}

function shuffleDeck(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function initNewHand() {
  let deck = [];
  for (let n of NAIPES_ORDEM) {
    for (let v of VALORES_ORDEM) {
      deck.push({ nome: v, naipe: n, isRed: (n === '♥' || n === '♦') });
    }
  }

  shuffleDeck(deck);
  shuffleDeck(deck);

  const vira = deck.pop();
  let hands = {};

  for (let i = 0; i < 6; i++) {
    hands[i] = [deck.pop(), deck.pop(), deck.pop()];
  }

  const previousScoreA = roomState.state ? roomState.state.scoreA : 0;
  const previousScoreB = roomState.state ? roomState.state.scoreB : 0;
  const firstTurn = roomState.state ? (roomState.state.handStartPlayer + 1) % 6 : 0;

  roomState.hands = hands;
  roomState.state = {
    started: true,
    isWaitingRoundDelay: false,
    scoreA: previousScoreA,
    scoreB: previousScoreB,
    handValue: 1,
    vira: vira,
    handStartPlayer: firstTurn,
    currentTurn: firstTurn,
    roundWinners: [],
    roundStartPlayer: firstTurn,
    playedCardsInRound: [],
    turnStartTime: Date.now(),
    log: "Nova mão iniciada! Valendo 1 ponto."
  };

  broadcastState();
}

function addBot() {
  if (!isHost) return alert("Apenas quem criou a sala pode adicionar Bots!");
  let players = roomState.players || [];
  if (players.length >= 6) return alert("A sala já está cheia!");

  const takenSeats = players.map(p => p.seat);
  const botSeat = [0, 1, 2, 3, 4, 5].find(s => !takenSeats.includes(s));
  const botTeam = (botSeat % 2 === 0) ? 'A' : 'B';

  players.push({ name: `Bot ${botSeat + 1}`, seat: botSeat, team: botTeam, isBot: true });
  roomState.players = players;

  if (players.length === 6 && (!roomState.state || !roomState.state.started)) {
    initNewHand();
  } else {
    broadcastState();
  }
}

function askTruco() {
  if (!isHost) {
    channel.postMessage({ type: 'TRUCO_REQUEST', seat: mySeat });
    return;
  }
  executeTrucoSeat(mySeat);
}

function executeTrucoSeat(seat) {
  let state = roomState.state;
  if (!state || !state.started || state.currentTurn !== seat) return;

  if (state.handValue === 1) state.handValue = 3;
  else if (state.handValue === 3) state.handValue = 6;
  else if (state.handValue === 6) state.handValue = 9;
  else if (state.handValue === 9) state.handValue = 12;

  const player = roomState.players.find(p => p.seat === seat);
  state.log = `🔥 TRUCO PEDIDO por ${player ? player.name : 'Jogador'}! Valendo ${state.handValue} pt(s)!`;
  broadcastState();
}

function playCard(cardIdx) {
  if (!roomState.state || roomState.state.currentTurn !== mySeat) {
    return alert("Aguarde a sua vez de jogar!");
  }

  if (!isHost) {
    channel.postMessage({ type: 'PLAY_CARD', seat: mySeat, cardIdx: cardIdx });
    return;
  }

  executePlaySeat(mySeat, cardIdx);
}

function executePlaySeat(seat, cardIdx) {
  const state = roomState.state;
  if (!state || state.isWaitingRoundDelay) return;

  const player = roomState.players.find(p => p.seat === seat);
  let hand = roomState.hands[seat] || [];

  if (hand.length === 0) return;

  const card = hand.splice(cardIdx, 1)[0];
  const power = getCardPower(card, state.vira);

  if (!state.playedCardsInRound) state.playedCardsInRound = [];

  state.playedCardsInRound.push({
    card: card,
    seat: seat,
    team: player.team,
    power: power,
    playerName: player.name
  });

  state.log = `${player.name} jogou ${card.nome}${card.naipe}`;

  if (state.playedCardsInRound.length === 6) {
    state.isWaitingRoundDelay = true;
    broadcastState();

    setTimeout(() => {
      evaluateRound();
    }, 2500);
  } else {
    state.currentTurn = (state.currentTurn + 1) % 6;
    state.turnStartTime = Date.now();
    broadcastState();
  }
}

function evaluateRound() {
  const state = roomState.state;
  const cards = state.playedCardsInRound;

  let maxPower = -1;
  cards.forEach(c => {
    if (c.power > maxPower) maxPower = c.power;
  });

  const topCards = cards.filter(c => c.power === maxPower);
  let roundWinnerTeam = '';
  let roundWinnerSeat = -1;

  const hasTeamA = topCards.some(c => c.team === 'A');
  const hasTeamB = topCards.some(c => c.team === 'B');

  if (hasTeamA && hasTeamB) {
    roundWinnerTeam = 'E';
    state.log = `⚖️ Rodada empatada na carta ${topCards[0].card.nome}${topCards[0].card.naipe}!`;
    roundWinnerSeat = (state.roundStartPlayer + 1) % 6;
  } else {
    roundWinnerTeam = topCards[0].team;
    roundWinnerSeat = topCards[0].seat;
    state.log = `🏆 Trio ${roundWinnerTeam} venceu a rodada com ${topCards[0].card.nome}${topCards[0].card.naipe} (${topCards[0].playerName})!`;
  }

  if (!state.roundWinners) state.roundWinners = [];
  state.roundWinners.push(roundWinnerTeam);

  const rw = state.roundWinners;
  let handWinner = null;

  const countA = rw.filter(w => w === 'A').length;
  const countB = rw.filter(w => w === 'B').length;

  if (countA === 2) handWinner = 'A';
  else if (countB === 2) handWinner = 'B';
  else if (rw.length === 2 && rw[0] === 'E' && rw[1] !== 'E') handWinner = rw[1];
  else if (rw.length === 2 && rw[1] === 'E' && rw[0] !== 'E') handWinner = rw[0];
  else if (rw.length === 3) {
    if (rw[2] !== 'E') handWinner = rw[2];
    else handWinner = rw[0] !== 'E' ? rw[0] : 'A';
  }

  state.isWaitingRoundDelay = false;

  if (handWinner) {
    if (handWinner === 'A') state.scoreA += state.handValue;
    if (handWinner === 'B') state.scoreB += state.handValue;

    state.log += ` 🎉 TRIO ${handWinner} GANHOU A MÃO (+${state.handValue} pts)!`;
    broadcastState();

    setTimeout(() => {
      if (state.scoreA >= 12 || state.scoreB >= 12) {
        alert(`🏆 FIM DE JOGO! O TRIO ${state.scoreA >= 12 ? 'A' : 'B'} VENCEU A PARTIDA!`);
        resetMesa();
      } else {
        initNewHand();
      }
    }, 2500);
  } else {
    state.currentTurn = roundWinnerSeat;
    state.roundStartPlayer = roundWinnerSeat;
    state.playedCardsInRound = [];
    state.turnStartTime = Date.now();
    broadcastState();
  }
}

function checkBotTurn() {
  if (!isHost) return;
  const state = roomState.state;
  if (!state || !state.started || state.isWaitingRoundDelay) return;

  const currentSeat = state.currentTurn;
  const currentPlayer = (roomState.players || []).find(p => p && p.seat === currentSeat);

  if (currentPlayer && currentPlayer.isBot) {
    setTimeout(() => {
      const bestCardIdx = chooseBestBotCardIndex(currentSeat);
      executePlaySeat(currentSeat, bestCardIdx);
    }, 1000);
  }
}

function chooseBestBotCardIndex(botSeat) {
  const state = roomState.state;
  const botHand = roomState.hands[botSeat] || [];
  const botPlayer = roomState.players.find(p => p.seat === botSeat);
  const cardsOnTable = state.playedCardsInRound || [];

  if (botHand.length === 0) return 0;

  const botOptions = botHand.map((card, index) => ({
    index: index,
    power: getCardPower(card, state.vira)
  })).sort((a, b) => a.power - b.power);

  if (cardsOnTable.length === 0) return botOptions[0].index;

  let maxTablePower = -1;
  let winningTeam = '';

  cardsOnTable.forEach(c => {
    if (c.power > maxTablePower) {
      maxTablePower = c.power;
      winningTeam = c.team;
    }
  });

  if (winningTeam === botPlayer.team) return botOptions[0].index;

  const winningOption = botOptions.find(opt => opt.power > maxTablePower);
  if (winningOption) return winningOption.index;

  return botOptions[0].index;
}

function updateTimer() {
  if (!roomState.state || !roomState.state.started || roomState.state.isWaitingRoundDelay) return;

  const elapsedSeconds = Math.floor((Date.now() - roomState.state.turnStartTime) / 1000);
  const remaining = Math.max(0, 30 - elapsedSeconds);

  const timerEl = document.getElementById('timer');
  if (timerEl) timerEl.innerText = remaining;
}

function renderGame(room) {
  const players = room.players || [];
  const state = room.state;
  const hands = room.hands || {};

  // Atualiza assento do próprio jogador se encontrado pelo nome
  const me = players.find(p => p && p.name.toLowerCase() === myName.toLowerCase());
  if (me) mySeat = me.seat;

  for (let i = 0; i < 6; i++) {
    const info = document.getElementById(`info-${i}`);
    const cardsCont = document.getElementById(`cards-${i}`);
    const p = players.find(player => player && player.seat === i);

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

  if (state) {
    document.getElementById('score-a').innerText = state.scoreA || 0;
    document.getElementById('score-b').innerText = state.scoreB || 0;
    document.getElementById('hand-val').innerText = `${state.handValue} pt${state.handValue > 1 ? 's' : ''}`;
    document.getElementById('log').innerText = state.log || '';

    const viraSlot = document.getElementById('vira-card-slot');
    if (viraSlot && state.vira) {
      viraSlot.innerHTML = `<div class="card ${state.vira.isRed ? 'red' : ''}" style="cursor:default;">${state.vira.nome}${state.vira.naipe}</div>`;
    }

    const mat = document.getElementById('center-mat');
    if (mat) {
      mat.innerHTML = '';
      (state.playedCardsInRound || []).forEach(item => {
        const c = document.createElement('div');
        c.className = `card played ${item.card.isRed ? 'red' : ''}`;
        c.innerText = `${item.card.nome}${item.card.naipe}`;
        mat.appendChild(c);
      });
    }

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
    localStorage.removeItem(`truco_data_${roomCode}`);
  }
  location.reload();
}