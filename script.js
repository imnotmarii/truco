let roomCode = "";
let mySeat = -1;
let myName = "";
let myTeam = "";

let peer = null;
let connections = [];

// Hierarquia padrão do Truco (da menor para a maior)
const VALORES_ORDEM = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const NAIPES_ORDEM = ['♦', '♠', '♥', '♣'];

let roomState = {
  roomCode: "",
  players: [],
  hands: {},
  state: null
};

function getRoomStorageKey() {
  return `truco_room_${roomCode}`;
}

function loadLocalState() {
  const data = localStorage.getItem(getRoomStorageKey());
  return data ? JSON.parse(data) : null;
}

function saveAndBroadcastState(newState) {
  roomState = newState;
  localStorage.setItem(getRoomStorageKey(), JSON.stringify(roomState));
  
  connections.forEach(conn => {
    if (conn && conn.open) conn.send(roomState);
  });

  renderGame(roomState);
}

// Cálculo correto de poder considerando a MANILHA
function getCardPower(card, vira) {
  const viraIdx = VALORES_ORDEM.indexOf(vira.nome);
  const manilhaIdx = (viraIdx + 1) % VALORES_ORDEM.length;
  const manilhaNome = VALORES_ORDEM[manilhaIdx];

  // Se for manilha, ganha poder superior (100 a 103 baseado no naipe)
  if (card.nome === manilhaNome) {
    return 100 + NAIPES_ORDEM.indexOf(card.naipe);
  }
  
  // Carta comum
  return VALORES_ORDEM.indexOf(card.nome);
}

async function joinGame() {
  const roomInput = document.getElementById('room-code').value.trim().toUpperCase();
  const nameInput = document.getElementById('player-name').value.trim();
  const selectedTeam = document.getElementById('team-select').value;

  if (!roomInput) return alert("Digite o código da sala!");
  if (!nameInput) return alert("Digite o seu nome!");

  roomCode = roomInput;
  myName = nameInput;
  myTeam = selectedTeam;

  let saved = loadLocalState();
  if (saved && saved.roomCode === roomCode) {
    roomState = saved;
  } else {
    roomState = {
      roomCode: roomCode,
      players: [],
      hands: {},
      state: null
    };
  }

  let existingPlayer = roomState.players.find(p => p && p.name.toLowerCase() === myName.toLowerCase());

  if (existingPlayer) {
    mySeat = existingPlayer.seat;
    myTeam = existingPlayer.team;
  } else {
    if (roomState.players.length >= 6) {
      const botIndex = roomState.players.findIndex(p => p && p.isBot);
      if (botIndex !== -1) {
        roomState.players.splice(botIndex, 1);
      } else {
        return alert("Esta sala já está cheia!");
      }
    }

    const teamAPositions = [0, 2, 4];
    const teamBPositions = [1, 3, 5];
    const preferredPositions = myTeam === 'A' ? teamAPositions : teamBPositions;
    const takenSeats = roomState.players.map(p => p ? p.seat : -1);

    mySeat = preferredPositions.find(seat => !takenSeats.includes(seat));

    if (mySeat === undefined) {
      mySeat = [0, 1, 2, 3, 4, 5].find(seat => !takenSeats.includes(seat));
      myTeam = (mySeat % 2 === 0) ? 'A' : 'B';
    }

    roomState.players.push({ name: myName, seat: mySeat, team: myTeam, isBot: false });
  }

  document.getElementById('btn-join').disabled = true;

  if (roomState.players.length === 6 && (!roomState.state || !roomState.state.started)) {
    initNewHand();
  } else {
    saveAndBroadcastState(roomState);
  }

  initPeerConnection();

  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';

  setInterval(updateTimer, 1000);
}

function initPeerConnection() {
  const peerId = `truco-${roomCode}-${mySeat}`;
  peer = new Peer(peerId);

  peer.on('open', () => {
    for (let i = 0; i < 6; i++) {
      if (i !== mySeat) {
        const conn = peer.connect(`truco-${roomCode}-${i}`);
        setupConnection(conn);
      }
    }
  });

  peer.on('connection', (conn) => setupConnection(conn));
}

function setupConnection(conn) {
  connections.push(conn);
  conn.on('data', (data) => {
    roomState = data;
    localStorage.setItem(getRoomStorageKey(), JSON.stringify(roomState));
    renderGame(roomState);
  });
}

// Embaralhamento de alta aleatoriedade (Fisher-Yates)
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

  // Duplo embaralhamento para garantir aleatoriedade nas cartas
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

  saveAndBroadcastState(roomState);
}

function addBot() {
  if (roomState.players.length >= 6) return alert("A sala já está cheia!");

  const takenSeats = roomState.players.map(p => p.seat);
  const botSeat = [0, 1, 2, 3, 4, 5].find(s => !takenSeats.includes(s));
  const botTeam = (botSeat % 2 === 0) ? 'A' : 'B';

  roomState.players.push({ 
    name: `Bot ${botSeat + 1}`, 
    seat: botSeat, 
    team: botTeam, 
    isBot: true 
  });

  if (roomState.players.length === 6 && (!roomState.state || !roomState.state.started)) {
    initNewHand();
  } else {
    saveAndBroadcastState(roomState);
  }
}

function askTruco() {
  if (!roomState.state || !roomState.state.started) {
    return alert("A partida ainda não começou!");
  }

  let state = roomState.state;

  if (state.currentTurn !== mySeat) {
    return alert("Você só pode pedir TRUCO na sua vez de jogar!");
  }

  if (state.isWaitingRoundDelay) return;

  if (state.handValue >= 12) {
    return alert("A mão já está valendo 12 pontos!");
  }

  if (state.handValue === 1) state.handValue = 3;
  else if (state.handValue === 3) state.handValue = 6;
  else if (state.handValue === 6) state.handValue = 9;
  else if (state.handValue === 9) state.handValue = 12;

  const player = roomState.players.find(p => p.seat === mySeat);
  const meNome = player ? player.name : myName;

  state.log = `🔥 TRUCO PEDIDO por ${meNome}! A mão vale ${state.handValue} pt(s)!`;
  saveAndBroadcastState(roomState);
}

function playCard(cardIdx) {
  if (!roomState.state || roomState.state.currentTurn !== mySeat) {
    return alert("Aguarde a sua vez de jogar!");
  }

  if (roomState.state.isWaitingRoundDelay) return;

  executePlay(cardIdx);
}

function executePlay(cardIdx) {
  const state = roomState.state;
  if (state.isWaitingRoundDelay) return;

  const currentSeat = state.currentTurn;
  const player = roomState.players.find(p => p.seat === currentSeat);
  let hand = roomState.hands[currentSeat];

  if (!hand || hand.length === 0) return;

  const card = hand.splice(cardIdx, 1)[0];
  const power = getCardPower(card, state.vira);

  state.playedCardsInRound.push({
    card: card,
    seat: currentSeat,
    team: player.team,
    power: power,
    playerName: player.name
  });

  state.log = `${player.name} jogou ${card.nome}${card.naipe}`;

  if (state.playedCardsInRound.length === 6) {
    state.isWaitingRoundDelay = true;
    saveAndBroadcastState(roomState);

    setTimeout(() => {
      evaluateRound();
    }, 2500);
  } else {
    state.currentTurn = (state.currentTurn + 1) % 6;
    state.turnStartTime = Date.now();
    saveAndBroadcastState(roomState);
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
    saveAndBroadcastState(roomState);

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
    saveAndBroadcastState(roomState);
  }
}

// NOVA INTELIGÊNCIA DO BOT (Economiza se o oponente for imbatível)
function chooseBestBotCardIndex(botSeat) {
  const state = roomState.state;
  const botHand = roomState.hands[botSeat];
  const botPlayer = roomState.players.find(p => p.seat === botSeat);
  const cardsOnTable = state.playedCardsInRound;

  if (!botHand || botHand.length === 0) return 0;

  // Ordena as opções da mão do Bot da MAIS FRACA para a MAIS FORTE
  const botOptions = botHand.map((card, index) => ({
    index: index,
    power: getCardPower(card, state.vira)
  })).sort((a, b) => a.power - b.power);

  // Se o Bot for o primeiro a jogar na rodada, lança a carta mais fraca
  if (cardsOnTable.length === 0) {
    return botOptions[0].index;
  }

  // Descobre a maior carta jogada até agora na mesa e de qual time ela é
  let maxTablePower = -1;
  let winningTeam = '';

  cardsOnTable.forEach(c => {
    if (c.power > maxTablePower) {
      maxTablePower = c.power;
      winningTeam = c.team;
    }
  });

  // Se o próprio parceiro do Bot já estiver ganhando a rodada, o Bot descarta a menor carta dele
  if (winningTeam === botPlayer.team) {
    return botOptions[0].index;
  }

  // Procura a menor carta do Bot que consiga MATAR a maior carta da mesa
  const winningOption = botOptions.find(opt => opt.power > maxTablePower);

  if (winningOption) {
    // Encontrou uma carta capaz de fazer a rodada!
    return winningOption.index;
  }

  // Se nenhuma carta do Bot for suficiente para matar o oponente, ele GUARDA as melhores
  // e joga a carta MAIS FRACA da mão (para economizar)
  return botOptions[0].index;
}

function updateTimer() {
  if (!roomState.state || !roomState.state.started || roomState.state.isWaitingRoundDelay) return;

  const elapsedSeconds = Math.floor((Date.now() - roomState.state.turnStartTime) / 1000);
  const remaining = Math.max(0, 30 - elapsedSeconds);

  const timerEl = document.getElementById('timer');
  if (timerEl) timerEl.innerText = remaining;

  const currentSeat = roomState.state.currentTurn;
  const currentPlayer = roomState.players.find(p => p.seat === currentSeat);

  if (currentPlayer && currentPlayer.isBot) {
    if (remaining <= 28) {
      const bestCardIdx = chooseBestBotCardIndex(currentSeat);
      executePlay(bestCardIdx);
    }
  } else if (remaining === 0 && currentSeat === mySeat) {
    executePlay(0);
  }
}

function renderGame(room) {
  const players = room.players || [];
  const state = room.state;
  const hands = room.hands || {};

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
    localStorage.removeItem(getRoomStorageKey());
  }
  location.reload();
}