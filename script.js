// Configuração do Firebase com banco público temporário para comunicação em tempo real
const firebaseConfig = {
  databaseURL: "https://truco-6p-default-rtdb.firebaseio.com/"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

let roomCode = "";
let mySeat = -1;
let myName = "";
let myTeam = "";
let isHost = false;
let roomRef = null;

const VALORES_ORDEM = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const NAIPES_ORDEM = ['♦', '♠', '♥', '♣'];

let currentRoomData = null;

function getCardPower(card, vira) {
  if (!card || !vira) return -1;
  const viraIdx = VALORES_ORDEM.indexOf(card.nome ? card.nome : card);
  const viraCardIdx = VALORES_ORDEM.indexOf(vira.nome);
  const manilhaIdx = (viraCardIdx + 1) % VALORES_ORDEM.length;
  const manilhaNome = VALORES_ORDEM[manilhaIdx];

  if (card.nome === manilhaNome) {
    return 100 + NAIPES_ORDEM.indexOf(card.naipe);
  }
  return VALORES_ORDEM.indexOf(card.nome);
}

// CRIAR SALA
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

  roomRef = db.ref('rooms/' + roomCode);

  const initialRoom = {
    code: roomCode,
    players: [
      { name: myName, seat: 0, team: myTeam, isBot: false }
    ],
    state: {
      started: false,
      scoreA: 0,
      scoreB: 0,
      handValue: 1,
      log: "Aguardando jogadoras entrarem..."
    }
  };

  roomRef.set(initialRoom).then(() => {
    listenToRoom();
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
  });
}

// ENTRAR NA SALA
function joinGame() {
  const roomInput = document.getElementById('room-code').value.trim().toUpperCase();
  const nameInput = document.getElementById('player-name').value.trim();
  const selectedTeam = document.getElementById('team-select').value;

  if (!roomInput) return alert("Digite o código da sala!");
  if (!nameInput) return alert("Digite o seu nome!");

  roomCode = roomInput;
  myName = nameInput;
  myTeam = selectedTeam;
  isHost = false;

  roomRef = db.ref('rooms/' + roomCode);

  roomRef.once('value').then((snapshot) => {
    if (!snapshot.exists()) {
      return alert("Esta sala não existe! Peça para sua amiga criar a sala primeiro.");
    }

    const room = snapshot.val();
    let players = room.players || [];

    let existing = players.find(p => p && p.name.toLowerCase() === myName.toLowerCase());

    if (!existing) {
      if (players.length >= 6) {
        return alert("A sala já está cheia (máximo 6 jogadoras)!");
      }

      const takenSeats = players.map(p => p.seat);
      const newSeat = [0, 1, 2, 3, 4, 5].find(s => !takenSeats.includes(s));
      mySeat = newSeat;

      players.push({ name: myName, seat: newSeat, team: myTeam, isBot: false });

      roomRef.child('players').set(players);
    } else {
      mySeat = existing.seat;
    }

    listenToRoom();
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
  });
}

// ESCUTAR ATUALIZAÇÕES DA SALA EM TEMPO REAL
function listenToRoom() {
  roomRef.on('value', (snapshot) => {
    if (!snapshot.exists()) return;
    currentRoomData = snapshot.val();
    renderGame(currentRoomData);

    if (isHost) {
      checkAutoStart(currentRoomData);
      checkBotTurn(currentRoomData);
    }
  });
}

function checkAutoStart(room) {
  const players = room.players || [];
  if (players.length === 6 && (!room.state || !room.state.started)) {
    initNewHand();
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

  const prevScoreA = currentRoomData && currentRoomData.state ? currentRoomData.state.scoreA || 0 : 0;
  const prevScoreB = currentRoomData && currentRoomData.state ? currentRoomData.state.scoreB || 0 : 0;
  const firstTurn = currentRoomData && currentRoomData.state && currentRoomData.state.handStartPlayer !== undefined 
    ? (currentRoomData.state.handStartPlayer + 1) % 6 
    : 0;

  const newState = {
    started: true,
    isWaitingRoundDelay: false,
    scoreA: prevScoreA,
    scoreB: prevScoreB,
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

  roomRef.child('hands').set(hands);
  roomRef.child('state').set(newState);
}

function addBot() {
  if (!isHost) return alert("Apenas quem criou a sala pode adicionar Bots!");
  if (!currentRoomData) return;

  let players = currentRoomData.players || [];
  if (players.length >= 6) return alert("A sala já está cheia!");

  const takenSeats = players.map(p => p.seat);
  const botSeat = [0, 1, 2, 3, 4, 5].find(s => !takenSeats.includes(s));
  const botTeam = (botSeat % 2 === 0) ? 'A' : 'B';

  players.push({ name: `Bot ${botSeat + 1}`, seat: botSeat, team: botTeam, isBot: true });
  roomRef.child('players').set(players);
}

function playCard(cardIdx) {
  if (!currentRoomData || !currentRoomData.state || currentRoomData.state.currentTurn !== mySeat) {
    return alert("Aguarde a sua vez de jogar!");
  }

  let hands = currentRoomData.hands || {};
  let myHand = hands[mySeat] || [];

  if (myHand.length === 0) return;

  const card = myHand.splice(cardIdx, 1)[0];
  const power = getCardPower(card, currentRoomData.state.vira);
  const player = (currentRoomData.players || []).find(p => p.seat === mySeat);

  let playedCards = currentRoomData.state.playedCardsInRound || [];
  playedCards.push({
    card: card,
    seat: mySeat,
    team: player ? player.team : 'A',
    power: power,
    playerName: player ? player.name : 'Jogador'
  });

  const nextTurn = (currentRoomData.state.currentTurn + 1) % 6;
  const isRoundEnd = playedCards.length === 6;

  db.ref(`rooms/${roomCode}/hands/${mySeat}`).set(myHand);

  let updates = {
    'state/playedCardsInRound': playedCards,
    'state/log': `${player.name} jogou ${card.nome}${card.naipe}`
  };

  if (!isRoundEnd) {
    updates['state/currentTurn'] = nextTurn;
    updates['state/turnStartTime'] = Date.now();
  } else {
    updates['state/isWaitingRoundDelay'] = true;
  }

  roomRef.update(updates).then(() => {
    if (isRoundEnd && isHost) {
      setTimeout(() => {
        evaluateRound();
      }, 2000);
    }
  });
}

function evaluateRound() {
  if (!currentRoomData || !currentRoomData.state) return;
  const state = currentRoomData.state;
  const cards = state.playedCardsInRound || [];

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
    roundWinnerSeat = (state.roundStartPlayer + 1) % 6;
  } else {
    roundWinnerTeam = topCards[0].team;
    roundWinnerSeat = topCards[0].seat;
  }

  let rw = state.roundWinners || [];
  rw.push(roundWinnerTeam);

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

  if (handWinner) {
    let newScoreA = state.scoreA || 0;
    let newScoreB = state.scoreB || 0;

    if (handWinner === 'A') newScoreA += state.handValue;
    if (handWinner === 'B') newScoreB += state.handValue;

    roomRef.child('state').update({
      scoreA: newScoreA,
      scoreB: newScoreB,
      log: `🎉 TRIO ${handWinner} GANHOU A MÃO (+${state.handValue} pts)!`
    }).then(() => {
      setTimeout(() => {
        if (newScoreA >= 12 || newScoreB >= 12) {
          alert(`🏆 FIM DE JOGO! O TRIO ${newScoreA >= 12 ? 'A' : 'B'} VENCEU A PARTIDA!`);
          resetMesa();
        } else {
          initNewHand();
        }
      }, 2000);
    });
  } else {
    roomRef.child('state').update({
      currentTurn: roundWinnerSeat,
      roundStartPlayer: roundWinnerSeat,
      roundWinners: rw,
      playedCardsInRound: [],
      isWaitingRoundDelay: false,
      turnStartTime: Date.now(),
      log: roundWinnerTeam === 'E' ? "⚖️ Rodada empatada!" : `🏆 Rodada vencida pelo Trio ${roundWinnerTeam}`
    });
  }
}

function askTruco() {
  if (!currentRoomData || !currentRoomData.state) return;
  let handVal = currentRoomData.state.handValue || 1;

  if (handVal === 1) handVal = 3;
  else if (handVal === 3) handVal = 6;
  else if (handVal === 6) handVal = 9;
  else if (handVal === 9) handVal = 12;

  const player = (currentRoomData.players || []).find(p => p.seat === mySeat);
  roomRef.child('state').update({
    handValue: handVal,
    log: `🔥 TRUCO PEDIDO por ${player ? player.name : 'Jogador'}! Valendo ${handVal} pt(s)!`
  });
}

function checkBotTurn(room) {
  const state = room.state;
  if (!state || !state.started || state.isWaitingRoundDelay) return;

  const currentSeat = state.currentTurn;
  const currentPlayer = (room.players || []).find(p => p && p.seat === currentSeat);

  if (currentPlayer && currentPlayer.isBot) {
    setTimeout(() => {
      const botHand = (room.hands || {})[currentSeat] || [];
      if (botHand.length > 0) {
        playCardForBot(currentSeat, 0);
      }
    }, 1200);
  }
}

function playCardForBot(botSeat, cardIdx) {
  let hands = currentRoomData.hands || {};
  let botHand = hands[botSeat] || [];
  if (botHand.length === 0) return;

  const card = botHand.splice(cardIdx, 1)[0];
  const power = getCardPower(card, currentRoomData.state.vira);
  const player = currentRoomData.players.find(p => p.seat === botSeat);

  let playedCards = currentRoomData.state.playedCardsInRound || [];
  playedCards.push({
    card: card,
    seat: botSeat,
    team: player.team,
    power: power,
    playerName: player.name
  });

  const nextTurn = (botSeat + 1) % 6;
  const isRoundEnd = playedCards.length === 6;

  db.ref(`rooms/${roomCode}/hands/${botSeat}`).set(botHand);

  let updates = {
    'state/playedCardsInRound': playedCards,
    'state/log': `${player.name} jogou ${card.nome}${card.naipe}`
  };

  if (!isRoundEnd) {
    updates['state/currentTurn'] = nextTurn;
    updates['state/turnStartTime'] = Date.now();
  } else {
    updates['state/isWaitingRoundDelay'] = true;
  }

  roomRef.update(updates).then(() => {
    if (isRoundEnd && isHost) {
      setTimeout(() => {
        evaluateRound();
      }, 2000);
    }
  });
}

function renderGame(room) {
  const players = room.players || [];
  const state = room.state || {};
  const hands = room.hands || {};

  for (let i = 0; i < 6; i++) {
    const info = document.getElementById(`info-${i}`);
    const cardsCont = document.getElementById(`cards-${i}`);
    const p = players.find(player => player && player.seat === i);

    if (p) {
      if (info) info.innerText = `${p.name} (${p.team})`;

      if (cardsCont) {
        cardsCont.innerHTML = '';
        if (state.started && hands[i]) {
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

  document.getElementById('score-a').innerText = state.scoreA || 0;
  document.getElementById('score-b').innerText = state.scoreB || 0;
  document.getElementById('hand-val').innerText = `${state.handValue || 1} pt${(state.handValue || 1) > 1 ? 's' : ''}`;
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

function resetMesa() {
  if (roomRef) {
    roomRef.remove();
  }
  location.reload();
}