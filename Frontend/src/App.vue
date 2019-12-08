<template>
  <div id="app">
    <div v-show="status == 'init' || status == 'Waiting'" class="startChat">
      <div class="startBox">
        <input 
          class="channelInput"
          v-model.number="channelNumber"
          type="number"
          placeholder="Channel Number" />
        <button class="connectButton" @click="connect">Connect</button>
        <p>Status: {{status}}</p>
      </div>
      <div class="copyright">
        CS 552 Project - Online Video Chat
      </div>
    </div>
    <div v-show="status != 'init' && status != 'Waiting'" class="chatBox">
        <div class="textBox">
          <div class="messages">
            <div v-for="(message, index) in messages" :key="index">{{message}}</div>
          </div>
          <input class="outBoundInput" v-model="outBoundMessage" />
          <button class="sendButton" @click="send(outBoundMessage)">Send</button>
        </div>
        <div class="videoBox">
          <div class="cameras">
            <div class="myVideo">
              <video autoplay="autoplay" id="myVideo" controls muted="true" />
            </div>
            <div class="yourVideo">
              <video id="yourVideo" autoplay="autoplay" controls muted="true"/>
            </div>
          </div>
          <p>Status: {{status}}</p>
          <button class="sendButton" @click="call" v-show="status == 'Ready for call'">Call</button>
        </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'app',
  data() {
    return {
      outBoundMessage: '',
      channelNumber: '',
      pc: null,
      id: '',
      status: 'init',
      weWaited: '',
      signalingChannel: '',
      haveLocalMedia: false,
      myVideoStream: null,
      myVideo: null,
      yourVideoStream: null,
      yourVideo: null,
      messages: []
    }
  },
  methods: {
    connect() {
      let errorCB, scHandlers, handleMsg
      let key = this.channelNumber
      handleMsg = msg => {
        if (typeof msg === 'string') {
          this.messages.push(`Received: ${msg}`)
        }
        if (msg.type === 'offer') {
          this.pc.setRemoteDescription(new RTCSessionDescription(msg))
          this.pc.createAnswer(localDesc => {
            this.pc.setLocalDescription(localDesc)
            this.send(localDesc)
          }, _ => {_}, {
            mandatory: {
              OfferToReceiveAudio: true,
              OfferToReceiveVideo: true
            }
          })
        } else if (msg.type === 'answer') {
          this.pc.setRemoteDescription(new RTCSessionDescription(msg))
        } else if (msg.type === 'candidate') {
          this.pc.addIceCandidate(new RTCIceCandidate({
            sdpMLineIndex: msg.mlineindex,
            candidate: msg.candidate
          }))
        }
      }
      let self = this
      scHandlers = {
        onWaiting() {
          self.setStatus('Waiting')
          self.weWaited = true
        },
        onConnected() {
          self.setStatus('Connected')
          self.createPC()
        },
        onMessage: handleMsg
      }

      this.signalingChannel = this.createSignalingChannel(key, scHandlers)
      errorCB = function (msg) {
        document.getElementById('response').innerHTML = msg
      }

      this.signalingChannel.connect(errorCB)
    },

    createSignalingChannel (key, handlers) {
      handlers = handlers || {}

      let id, status,
      doNothing = function () { },
      initHandler = function (h) {
        return ((typeof h === 'function') && h) || doNothing;
      },
      waitingHandler = initHandler(handlers.onWaiting),
      connectedHandler = initHandler(handlers.onConnected),
      messageHandler = initHandler(handlers.onMessage);


      // Set up connection with signaling server
      function connect(failureCB) {
        failureCB = (typeof failureCB === 'function') ||
          function () { };

        // Handle connection response, which should be error or status
        //  of "connected" or "waiting"
        function handler() {
          if (this.readyState == this.DONE) {
            if (this.status == 200 && this.response != null) {
              var res = JSON.parse(this.response);
              if (res.err) {
                failureCB("error:  " + res.err);
                return;
              }

              // if no error, save status and server-generated id,
              // then start asynchronouse polling for messages
              id = res.id;
              status = res.status;
              poll();

              // run user-provided handlers for waiting and connected
              // states
              if (status === "waiting") {
                waitingHandler();
              } else {
                connectedHandler();
              }
              return;
            } else {
              failureCB("HTTP error:  " + this.status);
              return;
            }
          }
        }

        // open XHR and send the connection request with the key
        var client = new XMLHttpRequest();
        client.onreadystatechange = handler;
        client.open("GET", "/connect?key=" + key);
        client.send();
      }

      // poll() waits n ms between gets to the server.  n is at 10 ms
      // for 10 tries, then 100 ms for 10 tries, then 1000 ms from then
      // on. n is reset to 10 ms if a message is actually received.
      function poll() {
        var pollWaitDelay = (function () {
          var delay = 10, counter = 1;

          function reset() {
            delay = 10;
            counter = 1;
          }

          function increase() {
            counter += 1;
            if (counter > 20) {
              delay = 1000;
            } else if (counter > 10) {
              delay = 100;
            }                          // else leave delay at 10
          }

          function value() {
            return delay;
          }

          return { reset: reset, increase: increase, value: value };
        } ());

        // getLoop is defined and used immediately here.  It retrieves
        // messages from the server and then schedules itself to run
        // again after pollWaitDelay.value() milliseconds.
        (function getLoop() {
          get(function (response) {
            var i, msgs = (response && response.msgs) || [];

            // if messages property exists, then we are connected   
            if (response.msgs && (status !== "connected")) {
              // switch status to connected since it is now!
              status = "connected";
              connectedHandler();
            }
            if (msgs.length > 0) {           // we got messages
              pollWaitDelay.reset();
              for (i = 0; i < msgs.length; i += 1) {
                handleMessage(msgs[i]);
              }
            } else {                         // didn't get any messages
              pollWaitDelay.increase();
            }

            // now set timer to check again
            setTimeout(getLoop, pollWaitDelay.value());
          });
        } ());
      }


      // This function is part of the polling setup to check for
      // messages from the other browser.  It is called by getLoop()
      // inside poll().
      function get(getResponseHandler) {

        // response should either be error or a JSON object.  If the
        // latter, send it to the user-provided handler.
        function handler() {
          if (this.readyState == this.DONE) {
            if (this.status == 200 && this.response != null) {
              var res = JSON.parse(this.response);
              if (res.err) {
                getResponseHandler("error:  " + res.err);
                return;
              }
              getResponseHandler(res);
              return res;
            } else {
              getResponseHandler("HTTP error:  " + this.status);
              return;
            }
          }
        }

        // open XHR and request messages for my id
        var client = new XMLHttpRequest();
        client.onreadystatechange = handler;
        client.open("POST", "/get");
        client.send(JSON.stringify({ "id": id }));
      }


      // Schedule incoming messages for asynchronous handling.
      // This is used by getLoop() in poll().
      function handleMessage(msg) {   // process message asynchronously
        setTimeout(function () { messageHandler(msg); }, 0);
      }


      // Send a message to the other browser on the signaling channel
      function send(msg, responseHandler) {
        responseHandler = responseHandler || function () { };

        // parse response and send to handler
        function handler() {
          if (this.readyState == this.DONE) {
            if (this.status == 200 && this.response != null) {
              var res = JSON.parse(this.response);
              if (res.err) {
                responseHandler("error:  " + res.err);
                return;
              }
              responseHandler(res);
              return;
            } else {
              responseHandler("HTTP error:  " + this.status);
              return;
            }
          }
        }

        // open XHR and send my id and message as JSON string
        var client = new XMLHttpRequest();
        client.onreadystatechange = handler;
        client.open("POST", "/send");
        var sendData = { "id": id, "message": msg };
        client.send(JSON.stringify(sendData));
      }


      return {
        connect: connect,
        send: send
      };
    },

    setStatus(status) {
      this.status = status
    },

    createPC() {
      let stunUri = true,
        turnUri = false,
        config = new Array();
      if (stunUri) {
        config.push({
          url: 'stun:stunserver.org'
        })
      }
      if (turnUri) {
        if (stunUri) {
          config.push({
            url: 'turn:user@turn.webrtcbook.com',
            credential: 'test'
          })
        } else {
          config.push({
            url: 'turn:user@turn-only.webrtcbook.com',
            credential: 'test'
          })
        }
      }
      this.pc = new RTCPeerConnection({
        iceServers: config
      })
      this.pc.onicecandidate = e => {
        if (e.candidate) {
          this.send({
            type: 'candidate',
            mlineindex: e.candidate.sdpMLineIndex,
            candidate: e.candidate.candidate
          })
        }
      }
      this.pc.onaddstream = e => {
        this.yourVideoStream = e.stream
        this.yourVideo.srcObject = this.yourVideoStream
        this.setStatus('On call')
      }
      this.pc.onremovestream = _ => {_}

      if (this.pc && this.haveLocalMedia) {
        this.pc.addStream(this.myVideoStream)
        this.setStatus('Ready for call')
      }
    },

    connectedHandler() {
      alert('123')
    },

    send(msg) {
      if (typeof msg === 'string') {
        this.messages.push(`Sent: ${msg}`)
      }
      this.signalingChannel.send(msg)
    },
    
    call() {
      this.pc.createOffer(localDesc => {
        this.pc.setLocalDescription(localDesc)
        this.send(localDesc)
      }, _ => {_}, {
        mandatory: {
          OfferToReceiveAudio: true,
          OfferToReceiveVideo: true
        }
      })
    }
  },

  mounted() {
    this.myVideo = document.getElementById('myVideo')
    this.yourVideo = document.getElementById('yourVideo');
    navigator.getUserMedia({
      audio: true,
      video: true
    }, (stream) => {
      this.myVideoStream = stream
      this.haveLocalMedia = true
      this.myVideo.srcObject = this.myVideoStream

      if (this.pc && this.haveLocalMedia) {
        this.pc.addStream(this.myVideoStream)
        this.setStatus('Ready for call')
      }
    }, (e) => {
      alert(`${e}`)
    })
  }
}
</script>

<style>
body {
  margin: 0;
  font-family: Helvetica Neue, Helvetica, Hiragino Sans GB, Microsoft YaHei, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app, body, html {
  height: 100%;
}

#app {
  min-height: 768px;
  background: url(//res.wx.qq.com/a/wx_fed/webwx/res/static/img/2zrdI1g.jpg) no-repeat 50%;
  background-size: cover;

  display: flex;
  justify-content: center;
}

.startChat {
  display: flex;
  justify-content: center;
}

.startBox {
  margin-top: 192px;
  background-color: white;
  width: 384px;
  height: 512px;

  display: flex;
  flex-direction: column;
  align-items: center;
}

.copyright {
  position: absolute;
  bottom: 60px;
  right: 60px;
  color: #d3d3d3;
  font-size: 12px;
}

.channelInput{
  font-size: 56px;
  margin-top: 100px;
  width: 240px;
  height: 56px;
  line-height: 56px;
}

.channelInput::placeholder {
  font-size: 24px;
}

.connectButton {
  outline: none;
  color: white;
  background-color: #409eff;
  margin-top: 50px;
  width: 150px;
  height: 40px;
}

.sendButton {
  outline: none;
  color: white;
  background-color: #b2e281;
  margin-top: 15px;
  width: 150px;
  height: 40px;
}

.chatBox {
  margin-top: 100px;
  background-color: white;
  height: 80%;
  width: 70%;

  display: flex;
  justify-content: center;
}

.textBox {
  width: 30%;
  background-color: #2e3238;
  color: white;
  border-right: black 1px solid;

  display: flex;
  flex-direction: column;
  justify-content: space-around;
  align-items: center;
}

.videoBox {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 70%;
}

.messages {
  height: 80%;
  width: 100%;
}

.outBoundInput {
  width: 99%;
  height: 30px;
}

.cameras {
  display:flex;
  height: 85%;
  width: 100%;
}

.myVideo, #myVideo {
  width: 100%;
  height: 100%;
}

.yourVideo, #yourVideo {
  width: 100%;
  height: 100%;
}
</style>
