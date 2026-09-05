import React, { useEffect, useState, useCallback } from 'react';
import { socket } from './socket';
import { useVoiceChat } from './useVoiceChat';

const SPECIAL_ROLES = [
  { key: 'cursed', label: 'Kẻ bị nguyền rủa' },
  { key: 'seer', label: 'Tiên tri' },
  { key: 'witch', label: 'Phù thủy' },
  { key: 'hunter', label: 'Thợ săn' },
  { key: 'guard', label: 'Bảo vệ' },
  { key: 'doppelganger', label: 'Người nhân bản' },
];

const STEP_TITLES = {
  hunter: 'Thợ săn chọn người kéo theo',
  doppelganger: 'Người nhân bản chọn người để nhân bản',
  guard: 'Bảo vệ chọn người để bảo vệ',
  wolves: 'Ma Sói chọn người để cắn',
  seer: 'Tiên tri soi phe',
  witch: 'Phù thủy hành động',
};

function PlayerButton({ name, disabled, selected, onClick, tag }) {
  return (
    <button
      className={`player-btn${selected ? ' selected' : ''}`}
      disabled={disabled}
      onClick={() => onClick(name)}
    >
      <span className="player-avatar">{name.slice(0, 2).toUpperCase()}</span>
      <span className="player-name">{name}</span>
      {tag && <span className="player-tag">{tag}</span>}
    </button>
  );
}

export default function App() {
  const [screen, setScreen] = useState('login'); // login | lobby | game
  const [username, setUsername] = useState('');
  const [loginInput, setLoginInput] = useState('');
  const [loginError, setLoginError] = useState('');

  const [lobby, setLobby] = useState({ users: [], online: {}, hostUsername: null, config: null, gameStarted: false });
  const [isHost, setIsHost] = useState(false);
  const [cfgVillager, setCfgVillager] = useState(1);
  const [cfgWolf, setCfgWolf] = useState(2);
  const [cfgSpecial, setCfgSpecial] = useState([]);

  const [myRole, setMyRole] = useState(null);
  const [phase, setPhase] = useState({ status: null, round: 1, aliveCount: 8 });
  const [turn, setTurn] = useState(null); // payload for own turn, or null
  const [deadSet, setDeadSet] = useState(new Set());
  const [wolfVotes, setWolfVotes] = useState({});
  const [seerResult, setSeerResult] = useState(null);
  const [privateMsg, setPrivateMsg] = useState(null); // cursed_converted / doppel_inherit banners
  const [nightSummary, setNightSummary] = useState(null);
  const [dayVote, setDayVote] = useState(null); // { alive, votes }
  const [dayVoteResult, setDayVoteResult] = useState(null);
  const [executeVote, setExecuteVote] = useState(null); // { target, votes }
  const [executeResult, setExecuteResult] = useState(null);
  const [gameOver, setGameOver] = useState(null);
  const [banner, setBanner] = useState('');
  const { micOn, toggleMic, remoteStreams, voiceOn } = useVoiceChat(username, lobby.users);

  // witch sub-state
  const [witchChoice, setWitchChoice] = useState(null); // 'heal' | 'kill' | null

  useEffect(() => {
    const onLoginResult = (res) => {
      if (res.ok) {
        setUsername(res.username);
        setIsHost(res.isHost);
        setScreen((s) => (s === 'login' ? 'lobby' : s));
        setLoginError('');
      } else {
        setLoginError(res.message || 'Đăng nhập thất bại');
      }
    };
    const onLobbyUpdate = (data) => {
      setLobby(data);
      setIsHost(data.hostUsername === username || data.hostUsername === localStorage.getItem('masoi_username'));
      if (data.gameStarted) {
        setScreen((s) => (s === 'login' ? s : 'game'));
      } else {
        setScreen((s) => (s === 'login' ? s : 'lobby'));
      }
    };
    const onGameStarted = () => {
      setScreen('game');
      setDeadSet(new Set());
      setGameOver(null);
      setNightSummary(null);
      setDayVoteResult(null);
      setExecuteResult(null);
    };
    const onYourRole = (r) => setMyRole(r);
    const onPhaseUpdate = (p) => {
      setPhase(p);
      setTurn(null);
      setWolfVotes({});
      setSeerResult(null);
      setWitchChoice(null);
      if (p.status === 'night') { setDayVote(null); setDayVoteResult(null); setExecuteVote(null); setExecuteResult(null); }
    };
    const onYourTurn = (t) => { setTurn(t); setWitchChoice(null); if (t.step === 'wolves') setWolfVotes(t.votes || {}); };
    const onWolfVoteUpdate = (d) => setWolfVotes(d.votes || {});
    const onSeerResult = (r) => setSeerResult(r);
    const onCursedConverted = (m) => setPrivateMsg({ type: 'cursed', message: m.message });
    const onDoppelInherit = (m) => { setMyRole({ role: m.role, label: m.label, team: m.team }); setPrivateMsg({ type: 'doppel', message: m.message }); };
    const onNightSummary = (s) => setNightSummary(s);
    const onDayVoteOpen = (d) => { setDayVote({ alive: d.alive, votes: {} }); setDayVoteResult(null); };
    const onDayVoteUpdate = (d) => setDayVote((prev) => (prev ? { ...prev, votes: d.votes } : prev));
    const onDayVoteResultEv = (r) => setDayVoteResult(r);
    const onExecuteVoteOpen = (d) => { setExecuteVote({ target: d.target, votes: {} }); setExecuteResult(null); };
    const onExecuteVoteUpdate = (d) => setExecuteVote((prev) => (prev ? { ...prev, votes: d.votes } : prev));
    const onExecuteResultEv = (r) => {
      setExecuteResult(r);
      if (r.deaths?.length) setDeadSet((prev) => new Set([...prev, ...r.deaths]));
    };
    const onGameOver = (d) => setGameOver(d);
    const onErrorMessage = (e) => { setBanner(e.message); setTimeout(() => setBanner(''), 3500); };
    const onGameSnapshot = (d) => {
      if (Array.isArray(d.deadPlayers)) setDeadSet(new Set(d.deadPlayers));
    };

    socket.on('login_result', onLoginResult);
    socket.on('lobby_update', onLobbyUpdate);
    socket.on('game_started', onGameStarted);
    socket.on('your_role', onYourRole);
    socket.on('phase_update', onPhaseUpdate);
    socket.on('your_turn', onYourTurn);
    socket.on('wolf_vote_update', onWolfVoteUpdate);
    socket.on('seer_result', onSeerResult);
    socket.on('cursed_converted', onCursedConverted);
    socket.on('doppel_inherit', onDoppelInherit);
    socket.on('night_summary', onNightSummary);
    socket.on('day_vote_open', onDayVoteOpen);
    socket.on('day_vote_update', onDayVoteUpdate);
    socket.on('day_vote_result', onDayVoteResultEv);
    socket.on('execute_vote_open', onExecuteVoteOpen);
    socket.on('execute_vote_update', onExecuteVoteUpdate);
    socket.on('execute_result', onExecuteResultEv);
    socket.on('game_over', onGameOver);
    socket.on('error_message', onErrorMessage);
    socket.on('game_snapshot', onGameSnapshot);

    return () => {
      socket.off('login_result', onLoginResult);
      socket.off('lobby_update', onLobbyUpdate);
      socket.off('game_started', onGameStarted);
      socket.off('your_role', onYourRole);
      socket.off('phase_update', onPhaseUpdate);
      socket.off('your_turn', onYourTurn);
      socket.off('wolf_vote_update', onWolfVoteUpdate);
      socket.off('seer_result', onSeerResult);
      socket.off('cursed_converted', onCursedConverted);
      socket.off('doppel_inherit', onDoppelInherit);
      socket.off('night_summary', onNightSummary);
      socket.off('day_vote_open', onDayVoteOpen);
      socket.off('day_vote_update', onDayVoteUpdate);
      socket.off('day_vote_result', onDayVoteResultEv);
      socket.off('execute_vote_open', onExecuteVoteOpen);
      socket.off('execute_vote_update', onExecuteVoteUpdate);
      socket.off('execute_result', onExecuteResultEv);
      socket.off('game_over', onGameOver);
      socket.off('error_message', onErrorMessage);
      socket.off('game_snapshot', onGameSnapshot);
    };
  }, [username]);

  useEffect(() => {
    if (nightSummary?.deaths?.length) {
      setDeadSet((prev) => new Set([...prev, ...nightSummary.deaths]));
    }
  }, [nightSummary]);

  // Tự đăng nhập lại mỗi khi socket connect/reconnect (kể cả reconnect ngầm do mất mạng,
  // app bị đưa xuống nền trên điện thoại...), không chỉ lúc mount trang lần đầu.
  // Nếu không có cái này, sau khi reconnect ngầm server vẫn map username -> socket.id CŨ,
  // dẫn tới các emit riêng cho user (vd: your_turn) bị gửi vào socket chết, người chơi
  // không thấy lượt của mình.
  useEffect(() => {
    const onConnect = () => {
      const saved = localStorage.getItem('masoi_username');
      if (saved) socket.emit('login', { username: saved });
    };
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, []);

  const doLogin = useCallback((name) => {
    const u = (name || loginInput).trim();
    if (!u) return;
    localStorage.setItem('masoi_username', u);
    socket.emit('login', { username: u });
  }, [loginInput]);

  const doLogout = useCallback(() => {
    localStorage.removeItem('masoi_username');
    socket.disconnect();
    window.location.reload();
  }, []);

  const toggleSpecial = (key) => {
    setCfgSpecial((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const submitConfig = () => {
    socket.emit('host_set_config', {
      villagerCount: Number(cfgVillager),
      wolfCount: Number(cfgWolf),
      enabledSpecialRoles: cfgSpecial,
    });
  };

  const startGame = () => socket.emit('host_start_game');
  const resetGame = () => socket.emit('host_reset_game');
  const endGame = () => {
    if (window.confirm('Kết thúc ván đấu hiện tại cho tất cả mọi người? Có thể chơi lại ngay sau đó.')) {
      socket.emit('host_end_game');
    }
  };

  // ---------------- RENDER ----------------
  if (screen === 'login') {
    return (
      <div className="app-shell center-screen">
        <div className="card">
          <h1 className="title">🐺 Ma Sói Realtime</h1>
          <p className="subtitle">Nhập đúng tên đăng nhập của bạn để vào phòng</p>
          <input
            className="text-input"
            placeholder="username"
            value={loginInput}
            onChange={(e) => setLoginInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doLogin()}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button className="primary-btn" onClick={() => doLogin()}>Vào phòng</button>
          {loginError && <div className="error-text">{loginError}</div>}
        </div>
      </div>
    );
  }

  if (screen === 'lobby') {
    const allOnline = lobby.users.length > 0 && lobby.users.every((u) => lobby.online[u]);
    return (
      <div className="app-shell">
        <div className="topbar">
          <span>Xin chào, <b>{username}</b>{isHost && <span className="host-badge">Chủ phòng</span>}</span>
          <button className="logout-btn" onClick={doLogout}>Đăng xuất</button>
        </div>
        <div className="card">
          <h2 className="section-title">Người chơi ({Object.values(lobby.online).filter(Boolean).length}/8)</h2>
          <div className="player-grid">
            {lobby.users.map((u) => (
              <div key={u} className={`lobby-player ${lobby.online[u] ? 'online' : 'offline'}`}>
                <span className="dot" />{u}
              </div>
            ))}
          </div>
          <VoiceBar micOn={micOn} toggleMic={toggleMic} voiceOn={voiceOn} username={username} remoteStreams={remoteStreams} />
        </div>

        {isHost ? (
          <div className="card">
            <h2 className="section-title">Cấu hình ván đấu</h2>
            <div className="field-row">
              <label>Số dân làng bắt buộc</label>
              <input type="number" min="0" max="8" value={cfgVillager}
                onChange={(e) => setCfgVillager(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Số ma sói bắt buộc</label>
              <input type="number" min="1" max="8" value={cfgWolf}
                onChange={(e) => setCfgWolf(e.target.value)} />
            </div>
            <label className="field-label">Vai trò đặc biệt được phép random</label>
            <div className="chip-row">
              {SPECIAL_ROLES.map((r) => (
                <button
                  key={r.key}
                  className={`chip${cfgSpecial.includes(r.key) ? ' chip-active' : ''}`}
                  onClick={() => toggleSpecial(r.key)}
                >{r.label}</button>
              ))}
            </div>
            <button className="secondary-btn" onClick={submitConfig}>Lưu cấu hình</button>
            {lobby.config && (
              <div className="config-summary">
                Đã lưu: {lobby.config.villagerCount} dân, {lobby.config.wolfCount} sói,
                {' '}{lobby.config.enabledSpecialRoles.length} vai trò đặc biệt được bật.
              </div>
            )}
            <button className="primary-btn" disabled={!allOnline || !lobby.config} onClick={startGame}>
              {allOnline ? 'Bắt đầu ván đấu' : 'Đang chờ đủ 8 người online...'}
            </button>
          </div>
        ) : (
          <div className="card center-text">
            <p>Đang chờ chủ phòng ({lobby.hostUsername}) thiết lập và bắt đầu ván đấu...</p>
          </div>
        )}
        {banner && <div className="toast">{banner}</div>}
      </div>
    );
  }

  if (screen === 'game') {
    if (gameOver) {
      return (
        <div className="app-shell">
          <div className="card center-text">
            <VoiceBar micOn={micOn} toggleMic={toggleMic} voiceOn={voiceOn} username={username} remoteStreams={remoteStreams} />
            <h1 className="title">{gameOver.winner === 'wolves' ? '🐺 Phe Ma Sói thắng!' : '🛡️ Phe Dân làng thắng!'}</h1>
            {isHost && <button className="primary-btn" onClick={resetGame}>Chơi lại từ đầu</button>}
            <button className="logout-btn" onClick={doLogout}>Đăng xuất</button>
            <h3 className="section-title">Vai trò của mọi người</h3>
            <div className="reveal-list">
              {Object.entries(gameOver.reveal).map(([u, info]) => (
                <div key={u} className={`reveal-row ${info.alive ? '' : 'dead'}`}>
                  <span>{u}</span>
                  <span className="reveal-role">{info.label}{!info.alive && ' (đã chết)'}</span>
                </div>
              ))}
            </div>
            {isHost && <button className="primary-btn" onClick={resetGame}>Chơi lại từ đầu</button>}
          </div>
        </div>
      );
    }

    const alive = lobby.users.filter((u) => !deadSet.has(u));
    const isMyTurn = turn && phase.status === 'night';
    const iAmDead = deadSet.has(username);

    return (
      <div className="app-shell">
        <div className="topbar">
          <span>{username}{iAmDead && <span className="dead-badge">Đã chết</span>}</span>
          <span>{phase.status === 'night' ? `🌙 Đêm ${phase.round}` : phase.status === 'day_vote' ? `☀️ Ngày ${phase.round} - Bỏ phiếu` : phase.status === 'day_execute' ? `⚖️ Ngày ${phase.round} - Xử tử` : ''}</span>
          {isHost && <button className="logout-btn" onClick={endGame}>Kết thúc ván</button>}
          <button className="logout-btn" onClick={doLogout}>Đăng xuất</button>
        </div>

        <VoiceBar micOn={micOn} toggleMic={toggleMic} voiceOn={voiceOn} username={username} remoteStreams={remoteStreams} />

        {myRole && (
          <div className="card role-card">
            <div className="role-label">Vai trò của bạn</div>
            <div className="role-name">{myRole.label}</div>
            <div className={`role-team team-${myRole.team}`}>{myRole.team === 'wolf' ? 'Phe Ma Sói' : 'Phe Dân làng'}</div>
          </div>
        )}

        {privateMsg && (
          <div className="card private-banner" onClick={() => setPrivateMsg(null)}>
            {privateMsg.message}
            <div className="tap-hint">(chạm để đóng)</div>
          </div>
        )}

        {nightSummary && phase.status !== 'night' && (
          <div className="card summary-banner">
            <b>Kết quả đêm {nightSummary.round}:</b>{' '}
            {nightSummary.deathCount === 0 ? 'Không có ai chết đêm qua.' :
              `${nightSummary.deathCount} người đã chết: ${nightSummary.deaths.join(', ')}`}
          </div>
        )}

        {/* ---------- NIGHT: my turn ---------- */}
        {phase.status === 'night' && isMyTurn && (
          <NightTurnPanel
            key={`${turn.step}-${turn.round}`}
            turn={turn}
            witchChoice={witchChoice}
            setWitchChoice={setWitchChoice}
            wolfVotes={wolfVotes}
            username={username}
            seerResult={seerResult}
          />
        )}

        {/* ---------- NIGHT: waiting ---------- */}
        {phase.status === 'night' && !isMyTurn && (
          <div className="card center-text waiting-card">
            {iAmDead ? 'Bạn đã chết, chỉ có thể theo dõi ván đấu.' : 'Trời đang tối... một ai đó đang thực hiện hành động của họ. Vui lòng chờ.'}
          </div>
        )}

        {/* ---------- DAY VOTE ---------- */}
        {phase.status === 'day_vote' && dayVote && (
          <DayVotePanel dayVote={dayVote} username={username} iAmDead={iAmDead} result={dayVoteResult} />
        )}

        {/* ---------- EXECUTE VOTE ---------- */}
        {phase.status === 'day_execute' && executeVote && (
          <ExecuteVotePanel executeVote={executeVote} username={username} iAmDead={iAmDead} result={executeResult} />
        )}

        <div className="card players-status-card">
          <h3 className="section-title">Người chơi còn sống ({alive.length})</h3>
          <div className="player-grid small">
            {lobby.users.map((u) => (
              <div key={u} className={`status-chip ${deadSet.has(u) ? 'dead' : 'alive'}`}>{u}</div>
            ))}
          </div>
        </div>

        {banner && <div className="toast">{banner}</div>}
      </div>
    );
  }

  return null;
}

function VoiceBar({ micOn, toggleMic, voiceOn, username, remoteStreams }) {
  const speaking = Object.entries(voiceOn).filter(([u, on]) => on && u !== username);
  return (
    <>
      <div className="voice-bar">
        <button className={`mic-btn${micOn ? ' mic-on' : ''}`} onClick={toggleMic}>
          {micOn ? '🎤 Đang bật mic (bấm để tắt)' : '🔇 Bật mic'}
        </button>
        {speaking.length > 0 && (
          <span className="voice-speaking">Đang nói: {speaking.map(([u]) => u).join(', ')}</span>
        )}
      </div>
      {Object.entries(remoteStreams).map(([user, stream]) => (
        <audio
          key={user}
          autoPlay
          ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }}
        />
      ))}
    </>
  );
}

function NightTurnPanel({ turn, witchChoice, setWitchChoice, wolfVotes, username, seerResult }) {
  const [confirmedTarget, setConfirmedTarget] = useState(null);
  const title = STEP_TITLES[turn.step] || 'Lượt của bạn';

  const send = (event, payload) => socket.emit(event, payload);

  if (turn.step === 'hunter') {
    return (
      <div className="card turn-card">
        <h3 className="section-title">🏹 {title}</h3>
        <p className="hint">{turn.message}</p>
        {confirmedTarget ? (
          <div className="seer-result">Bạn đã chọn nối với <b>{confirmedTarget}</b>. Không thể đổi lựa chọn.</div>
        ) : (
          <PlayerGrid options={turn.options} onPick={(t) => { setConfirmedTarget(t); send('action_hunter', { target: t }); }} />
        )}
      </div>
    );
  }
  if (turn.step === 'doppelganger') {
    return (
      <div className="card turn-card">
        <h3 className="section-title">🎭 {title}</h3>
        <p className="hint">{turn.message}</p>
        {confirmedTarget ? (
          <div className="seer-result">Bạn đã nhân bản <b>{confirmedTarget}</b>. Không thể đổi lựa chọn.</div>
        ) : (
          <PlayerGrid options={turn.options} onPick={(t) => { setConfirmedTarget(t); send('action_doppelganger', { target: t }); }} />
        )}
      </div>
    );
  }
  if (turn.step === 'guard') {
    return (
      <div className="card turn-card">
        <h3 className="section-title">🛡️ {title}</h3>
        <p className="hint">{turn.message}{turn.forbiddenTarget ? ` (Không thể chọn lại "${turn.forbiddenTarget}")` : ''}</p>
        {confirmedTarget ? (
          <div className="seer-result">Bạn đã chọn bảo vệ <b>{confirmedTarget}</b>. Không thể đổi lựa chọn.</div>
        ) : (
          <PlayerGrid options={turn.options} disabledOptions={turn.forbiddenTarget ? [turn.forbiddenTarget] : []}
            onPick={(t) => { setConfirmedTarget(t); send('action_guard', { target: t }); }} />
        )}
      </div>
    );
  }
  if (turn.step === 'wolves') {
    return (
      <div className="card turn-card">
        <h3 className="section-title">🐺 {title}</h3>
        <p className="hint">{turn.message}</p>
        <div className="wolf-team-note">Đồng bọn của bạn: {turn.teammates.filter((t) => t !== username).join(', ') || '(không còn ai)'}</div>
        <PlayerGrid options={turn.options} onPick={(t) => send('action_wolf_vote', { target: t })}
          voteMap={wolfVotes} />
        <div className="vote-tally">
          {Object.entries(wolfVotes).map(([voter, tgt]) => (
            <div key={voter} className="vote-line">{voter} → {tgt}</div>
          ))}
        </div>
      </div>
    );
  }
  if (turn.step === 'seer') {
    return (
      <div className="card turn-card">
        <h3 className="section-title">🔮 {title}</h3>
        <p className="hint">{turn.message}</p>
        {seerResult ? (
          <div className="seer-result">
            <b>{seerResult.target}</b> thuộc {seerResult.team === 'wolf' ? 'phe Ma Sói 🐺' : 'phe Dân làng 🙂'}
          </div>
        ) : (
          <PlayerGrid options={turn.options} onPick={(t) => send('action_seer', { target: t })} />
        )}
      </div>
    );
  }
  if (turn.step === 'witch') {
    return (
      <div className="card turn-card">
        <h3 className="section-title">🧪 {title}</h3>
        <p className="hint">{turn.message}</p>
        {!witchChoice && (
          <div className="witch-actions">
            {turn.canHeal && <button className="secondary-btn" onClick={() => setWitchChoice('heal')}>Dùng bình Cứu</button>}
            {turn.canKill && <button className="secondary-btn" onClick={() => setWitchChoice('kill')}>Dùng bình Giết</button>}
            <button className="secondary-btn" onClick={() => send('action_witch', { type: 'pass' })}>
              {turn.usedAny ? 'Xong, kết thúc lượt' : 'Không làm gì'}
            </button>
          </div>
        )}
        {witchChoice && (
          <>
            <p className="hint">Chọn người để {witchChoice === 'heal' ? 'cứu' : 'giết'}:</p>
            <PlayerGrid options={turn.options} onPick={(t) => send('action_witch', { type: witchChoice, target: t })} />
            <button className="link-btn" onClick={() => setWitchChoice(null)}>← Quay lại</button>
          </>
        )}
      </div>
    );
  }
  return null;
}

function PlayerGrid({ options, onPick, disabledOptions = [], voteMap }) {
  return (
    <div className="player-grid">
      {options.map((name) => (
        <PlayerButton
          key={name}
          name={name}
          disabled={disabledOptions.includes(name)}
          selected={voteMap ? Object.values(voteMap).includes(name) : false}
          onClick={onPick}
        />
      ))}
    </div>
  );
}

function DayVotePanel({ dayVote, username, iAmDead, result }) {
  const myVote = dayVote.votes[username];
  const send = (target) => socket.emit('action_day_vote', { target });
  return (
    <div className="card turn-card">
      <h3 className="section-title">🗳️ Bỏ phiếu treo cổ</h3>
      {result ? (
        <div className="hint">{result.willExecute ? `Đa số nghi ngờ ${result.target}. Chuyển sang bỏ phiếu xử tử...` : 'Không đủ đồng thuận — bỏ qua, chuyển sang đêm tiếp theo.'}</div>
      ) : iAmDead ? (
        <div className="hint">Bạn đã chết, chỉ có thể theo dõi.</div>
      ) : (
        <>
          <p className="hint">Chọn người bạn nghi ngờ, hoặc bỏ phiếu trắng.</p>
          <div className="player-grid">
            {dayVote.alive.filter((u) => u !== username).map((u) => (
              <PlayerButton key={u} name={u} selected={myVote === u} onClick={send} />
            ))}
          </div>
          <button className={`secondary-btn${myVote === 'abstain' ? ' selected-outline' : ''}`} onClick={() => send('abstain')}>
            Bỏ phiếu trắng
          </button>
          <div className="vote-tally">
            {Object.entries(dayVote.votes).map(([voter, tgt]) => (
              <div key={voter} className="vote-line">{voter} → {tgt === 'abstain' ? 'phiếu trắng' : tgt}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExecuteVotePanel({ executeVote, username, iAmDead, result }) {
  const myVote = executeVote.votes[username];
  const send = (choice) => socket.emit('action_execute_vote', { choice });
  return (
    <div className="card turn-card">
      <h3 className="section-title">⚖️ {executeVote.target} có bị treo cổ không?</h3>
      {result ? (
        <div className="hint">{result.executed ? `${result.deaths.join(', ')} đã chết.` : `${executeVote.target} được tha.`}</div>
      ) : iAmDead ? (
        <div className="hint">Bạn đã chết, chỉ có thể theo dõi.</div>
      ) : (
        <>
          <div className="witch-actions">
            <button className={`secondary-btn${myVote === 'kill' ? ' selected-outline' : ''}`} onClick={() => send('kill')}>Giết</button>
            <button className={`secondary-btn${myVote === 'spare' ? ' selected-outline' : ''}`} onClick={() => send('spare')}>Tha</button>
          </div>
          <div className="vote-tally">
            {Object.entries(executeVote.votes).map(([voter, c]) => (
              <div key={voter} className="vote-line">{voter} → {c === 'kill' ? 'giết' : 'sống'}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
