import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from './socket';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export function useVoiceChat(username, peerUsernames) {
    const [micOn, setMicOn] = useState(false);
    const [remoteStreams, setRemoteStreams] = useState({});
    const [voiceOn, setVoiceOn] = useState({});

    const localStreamRef = useRef(null);
    const peersRef = useRef({});

    const getOrCreatePeer = useCallback((peerUsername) => {
        if (peersRef.current[peerUsername]) return peersRef.current[peerUsername];

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        const polite = username > peerUsername; // quy ước tránh xung đột offer

        const entry = { pc, makingOffer: false, polite };
        peersRef.current[peerUsername] = entry;

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socket.emit('voice_signal', { to: peerUsername, data: { candidate: e.candidate } });
            }
        };

        pc.ontrack = (e) => {
            setRemoteStreams((prev) => ({ ...prev, [peerUsername]: e.streams[0] }));
        };

        pc.onnegotiationneeded = async () => {
            try {
                entry.makingOffer = true;
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('voice_signal', { to: peerUsername, data: { description: pc.localDescription } });
            } catch (err) {
                console.error(err);
            } finally {
                entry.makingOffer = false;
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`[voice] ${username} <-> ${peerUsername}:`, pc.connectionState);
            if (pc.connectionState === 'failed') {
                try { pc.restartIce(); } catch (e) { }
            }
            if (['failed', 'closed'].includes(pc.connectionState)) {
                setRemoteStreams((prev) => {
                    const copy = { ...prev };
                    delete copy[peerUsername];
                    return copy;
                });
                if (peersRef.current[peerUsername]?.pc === pc) {
                    delete peersRef.current[peerUsername];
                }
            }
        };

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));
        }

        return entry;
    }, [username]);

    useEffect(() => {
        const onSignal = async ({ from, data }) => {
            const entry = getOrCreatePeer(from);
            const { pc, polite } = entry;
            try {
                if (data.description) {
                    const offerCollision =
                        data.description.type === 'offer' &&
                        (entry.makingOffer || pc.signalingState !== 'stable');
                    const ignoreOffer = !polite && offerCollision;
                    if (ignoreOffer) return;

                    await pc.setRemoteDescription(data.description);
                    if (data.description.type === 'offer') {
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        socket.emit('voice_signal', { to: from, data: { description: pc.localDescription } });
                    }
                } else if (data.candidate) {
                    try { await pc.addIceCandidate(data.candidate); } catch (err) { console.error(err); }
                }
            } catch (err) {
                console.error('voice signal error', err);
            }
        };

        const onVoiceState = (d) => setVoiceOn(d.voiceOn || {});

        socket.on('voice_signal', onSignal);
        socket.on('voice_state_update', onVoiceState);
        return () => {
            socket.off('voice_signal', onSignal);
            socket.off('voice_state_update', onVoiceState);
        };
    }, [getOrCreatePeer]);

    // Mở sẵn kết nối tới tất cả người khác để có thể nghe bất cứ lúc nào
    useEffect(() => {
        peerUsernames.forEach((u) => {
            if (u !== username) getOrCreatePeer(u);
        });
    }, [peerUsernames, username, getOrCreatePeer]);

    const toggleMic = useCallback(async () => {
        if (micOn) {
            localStreamRef.current?.getTracks().forEach((t) => t.stop());
            localStreamRef.current = null;
            Object.values(peersRef.current).forEach(({ pc }) => {
                pc.getSenders().forEach((s) => { if (s.track) pc.removeTrack(s); });
            });
            setMicOn(false);
            socket.emit('voice_mic_state', { on: false });
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                });
                localStreamRef.current = stream;
                Object.values(peersRef.current).forEach(({ pc }) => {
                    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
                });
                setMicOn(true);
                socket.emit('voice_mic_state', { on: true });
            } catch (err) {
                alert('Không thể truy cập micro: ' + err.message);
            }
        }
    }, [micOn]);

    useEffect(() => () => {
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        Object.values(peersRef.current).forEach(({ pc }) => pc.close());
    }, []);

    return { micOn, toggleMic, remoteStreams, voiceOn };
}