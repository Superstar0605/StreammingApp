const WS_PORT = 8443; //make sure this matches the port for the webscokets server

var localUuid;
var localDisplayName;
var localStream;
var users = {};
var remoteStreams = {};
var serverConnection;
var peerConnections = {}; // key is uuid, values are peer connection object and user defined display name string

var peerConnectionConfig = {
  'iceServers': [
    { 'urls': 'stun:stun.stunprotocol.org:3478' },
    { 'urls': 'stun:stun.l.google.com:19302' },
  ]
};

function start() {
  localUuid = createUUID();

  // check if "&displayName=xxx" is appended to URL, otherwise alert user to populate
  var urlParams = new URLSearchParams(window.location.search);
  localDisplayName = urlParams.get('displayName') || prompt('Enter your name', '');

  // specify no audio for user media
  var constraints = {
    video: {
      width: { max: 320 },
      height: { max: 240 },
      frameRate: { max: 30 },
    },
    audio: true,
  };

  // set up local video stream
  if (navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        localStream = stream;
      }).catch(errorHandler)

      // set up websocket and message all existing clients
      .then(() => {
        serverConnection = new WebSocket('wss://' + window.location.hostname + ':' + WS_PORT);
        serverConnection.onmessage = gotMessageFromServer;
        serverConnection.onopen = event => {
          serverConnection.send(JSON.stringify({ 'displayName': localDisplayName, 'uuid': localUuid, 'dest': 'all' }));
        }
      }).catch(errorHandler);

  } else {
    alert('Your browser does not support getUserMedia API');
  }
}

// create user button dynamically
function makeUserButton() {
  var html = "";
  Object.keys(users).forEach((key) => {
    html += `<li> `;
    html += `<button data-uuid=${users[key].uuid} data-name=${users[key].name} class="btn btn-primary"> ${users[key].name} </button> </li>`
  })
  $("#users").empty();
  $("#users").html(html);
  console.log("make");
}

//get message from server
function gotMessageFromServer(message) {
  var signal = JSON.parse(message.data);
  var peerUuid = signal.uuid;
  if (typeof signal.displayName != 'undefined') {
    users[signal.displayName] = {
      name: signal.displayName,
      uuid: signal.uuid
    }
    makeUserButton();
  }

  // Ignore messages that are not for us or from ourselves
  if (peerUuid == localUuid || (signal.dest != localUuid && signal.dest != 'all')) return;

  if (signal.displayName && signal.dest == 'all') {
    // set up peer connection object for a newcomer peer
    setUpPeer(peerUuid, signal.displayName);
    serverConnection.send(JSON.stringify({ 'displayName': localDisplayName, 'uuid': localUuid, 'dest': peerUuid }));

  } else if (signal.displayName && signal.dest == localUuid) {
    // initiate call if we are the newcomer peer
      setUpPeer(peerUuid, signal.displayName, true);

  } else if (signal.sdp) {
    peerConnections[peerUuid].pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(function () {
      // Only create answers in response to offers
      if (signal.sdp.type == 'offer') {
        peerConnections[peerUuid].pc.createAnswer().then(description => createdDescription(description, peerUuid)).catch(errorHandler);
      }
    }).catch(errorHandler);

  } else if (signal.ice) {
    peerConnections[peerUuid].pc.addIceCandidate(new RTCIceCandidate(signal.ice)).catch(errorHandler);
  }
}

 // set up peer connection object for a newcomer peer
function setUpPeer(peerUuid, displayName, initCall = false) {
  peerConnections[peerUuid] = { 'displayName': displayName, 'pc': new RTCPeerConnection(peerConnectionConfig) };
  peerConnections[peerUuid].pc.onicecandidate = event => gotIceCandidate(event, peerUuid);
  peerConnections[peerUuid].pc.ontrack = event => gotRemoteStream(event, peerUuid);
  peerConnections[peerUuid].pc.oniceconnectionstatechange = event => checkPeerDisconnect(event, peerUuid, displayName);
  peerConnections[peerUuid].pc.addStream(localStream);

  if (initCall) {
    peerConnections[peerUuid].pc.createOffer().then(description => createdDescription(description, peerUuid)).catch(errorHandler);
  }
}

function gotIceCandidate(event, peerUuid) {
  if (event.candidate != null) {
    serverConnection.send(JSON.stringify({ 'ice': event.candidate, 'uuid': localUuid, 'dest': peerUuid }));
  }
}

function createdDescription(description, peerUuid) {
  console.log(`got description, peer ${peerUuid}`);
  peerConnections[peerUuid].pc.setLocalDescription(description).then(function () {
    serverConnection.send(JSON.stringify({ 'sdp': peerConnections[peerUuid].pc.localDescription, 'uuid': localUuid, 'dest': peerUuid }));
  }).catch(errorHandler);
}

//Display on webPage
function gotRemoteStream(event, peerUuid) {
  console.log(`got remote stream, peer ${peerUuid}`);
  //assign stream to new HTML video element
  remoteStreams[peerUuid] = event.streams[0];

}

//check for disconnection
function checkPeerDisconnect(event, peerUuid, displayname) {
  var state = peerConnections[peerUuid].pc.iceConnectionState;
  console.log(`connection with peer ${peerUuid} ${state}`);
  if (state === "failed" || state === "closed" || state === "disconnected") {
    delete peerConnections[peerUuid];
    Object.keys(users).forEach((key) => {if(users[key].uuid==peerUuid)delete users[key];});
    
    makeUserButton();
    console.log("deleted");
  
  }
}


function errorHandler(error) {
  console.log(error);
}


// Strictly speaking, it's not a real UUID, but it gets the job done here
function createUUID() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  }

  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

//execution
$(document).ready(function () {
  start();
  $("#users").on("click", ".btn", function () {
    $("#users li button").removeClass("active");
    $(this).addClass("active");
    if ($(this).data('uuid') == localUuid) {
      document.getElementById('localVideo').srcObject = localStream;
      document.getElementById('localVideoRTSP').srcObject = localStream;
    }
    else {
      
      document.getElementById('localVideo').srcObject = remoteStreams[$(this).data('uuid')];
      document.getElementById('localVideoRTSP').srcObject = $(this).data('uuid');
    }
  })
});