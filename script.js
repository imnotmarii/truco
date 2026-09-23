// Configuração do Banco de Dados Online em Tempo Real (Firebase)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  databaseURL: "https://truco-multiplayer-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let roomCode = "";
let mySeat = -1;
let myName = "";
let myTeam = "";

const VALORES_ORDEM = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const NAIPES_ORDEM = ['♦', '♠', '♥', '♣'];

let roomState = {
  roomCode: "",
  players: [],
  hands: {},
  state: null
};

// Cálculo correto do poder da carta considerando as MANILHAS
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

// Torna a função global para ser chamada pelo botão do HTML
window.joinGame = async function() {
  const roomInput = document.getElementById('room-code').value.trim().toUpperCase();
  const nameInput = document.getElementById('player-name').value.trim();
  const selectedTeam = document.getElementById('team-select').value;

  if (!roomInput) return alert("Digite o código da sala!");
  if (!nameInput) return alert("Digite o seu nome!");

  roomCode = roomInput;
  myName = nameInput;
  myTeam = selectedTeam;

  document.getElementById('btn-join').disabled = true;

  const roomRef = ref(db, `rooms/${roomCode}`);

  // Escuta as alterações na sala online em tempo real
  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      roomState = data;
      
      // Procura o assento do jogador atual se ainda não estiver definido
      const existingPlayer = (roomState.players || []).find(p => p && p.name.toLowerCase() === myName.toLowerCase());
      if (existingPlayer) {
        mySeat = existingPlayer.seat;
      }

      renderGame(roomState);
      checkBotTurn();
    }
  });

  // Tenta registrar o jogador na sala
  const snapshot = await new Promise(resolve => {
    onValue(roomRef, snap => resolve(snap), { onlyOnce: true });
  });

  let data = snapshot.val();

  if (!data) {
    // Cria a sala online se for a primeira a entrar
    mySeat = 0;
    roomState = {
      roomCode: roomCode,
      players: [{ name: myName, seat: 0, team: myTeam, isBot: false }],
      hands: {},
      state: null
    };
    await set(roomRef, roomState);
  } else {
    let players = data.players || [];
    let existingPlayer = players.find(p => p && p.name.toLowerCase() === myName.toLowerCase());

    if (!existingPlayer) {
      if (players.length >= 6) {
        const botIndex = players.findIndex(p => p && p.isBot);
        if (botIndex !== -1) {
          players.splice(botIndex, 1);
        } else {
          return alert("Esta sala já está cheia com 6 jogadoras!");
        }
      }

      const takenSeats = players.map(p => p.seat);
      mySeat = [0, 1, 2, 3, 4, 5].find(s => !takenSeats.includes(s));

      players.push({ name: myName, seat: mySeat, team: myTeam, isBot: false });
      
      await update(ref(db, `rooms/${roomCode}`), { players: players });

      if (players.length === 6 && (!data.state || !data.state.started)) {
        initNewHand(players);
      }
    }
  }

  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';

  setInterval(updateTimer, 1000);
};

function shuffleDeck(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

async function initNewHand(currentPlayers) {
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

  const newState = {
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

  await update(ref(db, `rooms/${roomCode}`), {
    players: currentPlayers || roomState.players,
    hands: hands,
    state: newState
  });
}

window.addBot = async function() {
  let players = roomState.players || [];
  if (players.length >= 6) return alert("A sala já está cheia!");

  const takenSeats = players.map(p => p.seat);
  const botSeat = [0, 1, 2, 3, 4, 5].find(s => !takenSeats.includes(s));
  const botTeam = (botSeat % 2 === 0) ? 'A' : 'B';

  players.push({ 
    name: `Bot ${botSeat + 1}`, 
    seat: botSeat, 
    team: botTeam, 
    isBot: true 
  });

  await update(ref(db, `rooms/${roomCode}`), { players: players });

  if (players.length === 6 && (!roomState.state || !roomState.state.started)) {
    initNewHand(players);
  }
};

window.askTruco = async function() {
  if (!roomState.state || !roomState.state.started) return;
  let state = roomState.state;

  if (state.currentTurn !== mySeat) return alert("Você só pode pedir TRUCO na sua vez!");

  if (state.handValue === 1) state.handValue = 3;
  else if (state.handValue === 3) state.handValue = 6;
  else if (state.handValue === 6) state.handValue = 9;
  else if (state.handValue === 9) state.handValue = 12;

  const player = roomState.players.find(p => p.seat === mySeat);
  state.log = `🔥 TRUCO PEDIDO por ${player ? player.name : myName}! Valendo ${state.handValue} pt(s)!`;

  await update(ref(db, `rooms/${roomCode}/state`), state);
};

window.playCard = function(cardIdx) {
  if (!roomState.state || roomState.state.currentTurn !== mySeat) {
    return alert("Aguarde a sua vez de jogar!");
  }
  executePlay(cardIdx);
};

async function executePlay(cardIdx) {
  const state = roomState.state;
  if (!state || state.isWaitingRoundDelay) return;

  const currentSeat = state.currentTurn;
  const player = roomState.players.find(p => p.seat === currentSeat);
  let hand = roomState.hands[currentSeat] || [];

  if (hand.length === 0) return;

  const card = hand.splice(cardIdx, 1)[0];
  const power = getCardPower(card, state.vira);

  if (!state.playedCardsInRound) state.playedCardsInRound = [];

  state.playedCardsInRound.push({
    card: card,
    seat: currentSeat,
    team: player.team,
    power: power,
    playerName: player.name
  });

  state.log = `${player.name} jogou ${card.nome}${card.naipe}`;

  roomState.hands[currentSeat] = hand;

  if (state.playedCardsInRound.length === 6) {
    state.isWaitingRoundDelay = true;
    await update(ref(db, `rooms/${roomCode}`), { hands: roomState.hands, state: state });

    setTimeout(() => {
      evaluateRound();
    }, 2500);
  } else {
    state.currentTurn = (state.currentTurn + 1) % 6;
    state.turnStartTime = Date.now();
    await update(ref(db, `rooms/${roomCode}`), { hands: roomState.hands, state: state });
  }
}

async function evaluateRound() {
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
    await update(ref(db, `rooms/${roomCode}/state`), state);

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
    await update(ref(db, `rooms/${roomCode}/state`), state);
  }
}

function checkBotTurn() {
  if (mySeat !== 0) return; // Apenas o Host executa a IA do Bot
  const state = roomState.state;
  if (!state || !state.started || state.isWaitingRoundDelay) return;

  const currentSeat = state.currentTurn;
  const currentPlayer = (roomState.players || []).find(p => p && p.seat === currentSeat);

  if (currentPlayer && currentPlayer.isBot) {
    setTimeout(() => {
      const bestCardIdx = chooseBestBotCardIndex(currentSeat);
      executePlay(bestCardIdx);
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
              c.onclick = () => window.playCard(idx);
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

window.resetMesa = async function() {
  if (roomCode) {
    await remove(ref(db, `rooms/${roomCode}`));
  }
  location.reload();
};