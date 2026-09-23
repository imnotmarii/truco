let mySeat = -1;
let myName = "";
let myTeam = "";

function getData(key) {
  const d = localStorage.getItem(key);
  return d ? JSON.parse(d) : null;
}

function setData(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function joinGame() {
  const input = document.getElementById('player-name');
  myName = input.value.trim();

  if (!myName) return alert("Por favor, digita o teu nome!");

  let players = getData('truco_players') || [];

  if (players.length >= 6) return alert("A mesa já está cheia (6/6)!");

  mySeat = players.length;
  myTeam = (mySeat % 2 === 0) ? 'A' : 'B';

  players.push({ name: myName, seat: mySeat, team: myTeam });
  setData('truco_players', players);

  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';

  if (players.length === 6) initHand();

  startPolling();
}

function addBot() {
  let players = getData('truco_players') || [];
  if (players.length >= 6) return alert("Mesa cheia!");

  const botSeat = players.length;
  const botTeam = (botSeat % 2 === 0) ? 'A' : 'B';

  players.push({ name: `Bot ${botSeat + 1}`, seat: botSeat, team: botTeam });
  setData('truco_players', players);

  if (players.length === 6) initHand();
}

function initHand() {
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

  setData('truco_hands', hands);
  setData('truco_state', {
    started: true,
    currentTurn: 0,
    handValue: 1,
    scoreA: 0,
    scoreB: 0,
    vira: vira,
    playedCards: [],
    log: "Mão iniciada! É a vez de jogar."
  });
}

function askTruco() {
  let state = getData('truco_state');
  if (!state || !state.started) return;

  if (state.handValue === 1) state.handValue = 3;
  else if (state.handValue === 3) state.handValue = 6;
  else if (state.handValue === 6) state.handValue = 9;
  else if (state.handValue === 9) state.handValue = 12;

  state.log = `🔥 TRUCO PEDIDO! A mão agora vale ${state.handValue} pontos!`;
  setData('truco_state', state);
}

function playCard(cardIdx) {
  let state = getData('truco_state');
  let hands = getData('truco_hands');

  if (!state || state.currentTurn !== mySeat) {
    return alert("Aguarde a sua vez de jogar!");
  }

  const card = hands[mySeat].splice(cardIdx, 1)[0];
  state.playedCards.push({ card: card, seat: mySeat });
  
  // Passa para a próxima jogadora no sentido horário
  state.currentTurn = (state.currentTurn + 1) % 6; 
  state.log = `${myName} jogou ${card.nome}${card.naipe}`;

  setData('truco_hands', hands);
  setData('truco_state', state);
}

function startPolling() {
  setInterval(() => {
    const players = getData('truco_players') || [];
    const state = getData('truco_state');
    const hands = getData('truco_hands') || {};

    for (let i = 0; i < 6; i++) {
      const info = document.getElementById(`info-${i}`);
      const cardsCont = document.getElementById(`cards-${i}`);

      if (players[i]) {
        info.innerText = `${players[i].name} (${players[i].team})`;

        if (state && state.started && hands[i]) {
          cardsCont.innerHTML = '';
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
      } else {
        info.innerText = 'Vazio';
        cardsCont.innerHTML = '';
      }
    }

    if (state) {
      document.getElementById('score-a').innerText = state.scoreA || 0;
      document.getElementById('score-b').innerText = state.scoreB || 0;
      document.getElementById('hand-val').innerText = `${state.handValue} pt${state.handValue > 1 ? 's' : ''}`;

      const viraSlot = document.getElementById('vira-card-slot');
      if (state.vira) {
        viraSlot.innerHTML = `<div class="card ${state.vira.isRed ? 'red' : ''}" style="cursor:default;">${state.vira.nome}${state.vira.naipe}</div>`;
      }

      const mat = document.getElementById('center-mat');
      mat.innerHTML = '';
      (state.playedCards || []).forEach(item => {
        const c = document.createElement('div');
        c.className = `card played ${item.card.isRed ? 'red' : ''}`;
        c.innerText = `${item.card.nome}${item.card.naipe}`;
        mat.appendChild(c);
      });

      for (let i = 0; i < 6; i++) {
        const info = document.getElementById(`info-${i}`);
        if (i === state.currentTurn) info.classList.add('active-turn');
        else info.classList.remove('active-turn');
      }

      document.getElementById('log').innerText = state.log;
    }
  }, 500);
}

function resetMesa() {
  localStorage.removeItem('truco_players');
  localStorage.removeItem('truco_state');
  localStorage.removeItem('truco_hands');
  location.reload();
}