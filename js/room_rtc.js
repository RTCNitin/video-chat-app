const APP_ID = ""       // Enter your Agora App id here

let uid = sessionStorage.getItem('uid')
if(!uid){
    uid = String(Math.floor(Math.random() * 10000))
    sessionStorage.setItem('uid', uid)
}

let token = null;
let client;

let rtmClient;
let channel;
let participantList = {};

const queryString = window.location.search
const urlParams = new URLSearchParams(queryString)
let roomId = urlParams.get('room')

if(!roomId){
    roomId = 'main'
}

let displayName = sessionStorage.getItem('display_name')
if(!displayName){
    window.location = 'lobby.html'
}

let localTracks = []
let remoteUsers = {}

let isActiveSpeakerView = false;
let activeSpeakerContainer;

let volList = {};
let highestVolumeUid = null;

let joinRoomInit = async () => {
    rtmClient = await AgoraRTM.createInstance(APP_ID)
    await rtmClient.login({uid,token})

    await rtmClient.addOrUpdateLocalUserAttributes({'name':displayName})

    channel = await rtmClient.createChannel(roomId)
    await channel.join()

    channel.on('MemberJoined', handleMemberJoined)
    channel.on('MemberLeft', handleMemberLeft)
    channel.on('ChannelMessage', handleChannelMessage)

    await getMembers()
    addBotMessageToDom(`Hi ${displayName}, Welcome to the room !`)

    client = AgoraRTC.createClient({mode:'rtc', codec:'vp8'})
    await client.join(APP_ID, roomId, token, uid)

    client.enableAudioVolumeIndicator();
    client.on('user-published', handleUserPublished)
    client.on('user-left', handleUserLeft)
    client.on("volume-indicator", volumes => {
        volumes.forEach(volume => {
            console.log(`UID ${volume.uid} Level ${volume.level}`);
            volList[volume.uid] = volume.level;
            highestVolumeUid = Object.keys(volList).reduce((a, b) => volList[a] > volList[b] ? a : b);

            // Update views based on the highest volume uid
            for (const uid in volList) {
                const container = document.getElementById(`user-container-${uid}`);
                if (!container) continue;
                // For Grid View
                if(uid === highestVolumeUid && !isActiveSpeakerView){
                    container.style.border = '5px solid yellow';
                }else{
                    container.style.border = '2px solid #b6ebdb';
                }
                // For Active Speaker View
                if(container && (container !== activeSpeakerContainer) && (uid === highestVolumeUid) && isActiveSpeakerView){
                    activeSpeakerContainer = container
                    activeSpeakerContainer.style.border = '2px solid #b6ebdb';
                    activeSpeakerContainer.click()
                }
            }
        });
    });
}

let joinStream = async () => {
    document.getElementById('join-btn').style.display = 'none'
    document.getElementsByClassName('stream__actions')[0].style.display = 'flex'

    localTracks = await AgoraRTC.createMicrophoneAndCameraTracks({}, {encoderConfig:{
        width:{min:640, ideal:1920, max:1920},
        height:{min:480, ideal:1080, max:1080}
    }})


    let player = `<div class="video__container" id="user-container-${uid}">
                    <div class="video-player" id="user-${uid}"></div>
                    <div class="participant-name">${displayName}</div>
                 </div>`

    document.getElementById('streams__container').insertAdjacentHTML('beforeend', player)
    document.getElementById(`user-container-${uid}`).addEventListener('click', expandVideoFrame)

    localTracks[1].play(`user-${uid}`)
    await client.publish([localTracks[0], localTracks[1]])
}

let handleUserPublished = async (user, mediaType) => {
    remoteUsers[user.uid] = user
    let {name} = await rtmClient.getUserAttributesByKeys(user.uid, ['name'])
    await client.subscribe(user, mediaType)

    let player = document.getElementById(`user-container-${user.uid}`)
    if(player === null){
        player = `<div class="video__container" id="user-container-${user.uid}">
                <div class="video-player" id="user-${user.uid}"></div>
                <div class="participant-name">${name}</div>
            </div>`

        document.getElementById('streams__container').insertAdjacentHTML('beforeend', player)
        document.getElementById(`user-container-${user.uid}`).addEventListener('click', expandVideoFrame)
   
    }

    if(displayFrame.style.display){
        let videoFrame = document.getElementById(`user-container-${user.uid}`)
        videoFrame.style.height = '100px'
        videoFrame.style.width = '100px'
    }

    if(mediaType === 'video'){
        user.videoTrack.play(`user-${user.uid}`)
    }

    if(mediaType === 'audio'){
        user.audioTrack.play()
    }

}

let handleUserLeft = async (user) => {
    delete remoteUsers[user.uid]
    let item = document.getElementById(`user-container-${user.uid}`)
    if(item){
        item.remove()
    }

    if(userIdInDisplayFrame === `user-container-${user.uid}`){
        displayFrame.style.display = null
        
        let videoFrames = document.getElementsByClassName('video__container')

        for(let i = 0; videoFrames.length > i; i++){
            videoFrames[i].style.height = '300px'
            videoFrames[i].style.width = '300px'
        }
    }
}

let toggleMic = async (e) => {
    let button = e.currentTarget

    if(localTracks[0].muted){
        await localTracks[0].setMuted(false)
        button.classList.add('active')
    }else{
        await localTracks[0].setMuted(true)
        button.classList.remove('active')
    }
}

let toggleCamera = async (e) => {
    let button = e.currentTarget

    if(localTracks[1].muted){
        await localTracks[1].setMuted(false)
        button.classList.add('active')
    }else{
        await localTracks[1].setMuted(true)
        button.classList.remove('active')
    }
}

let toggleActiveSpeaker = async (e) => {
    let activeSpeakerButton = e.currentTarget
    if(!isActiveSpeakerView){
        isActiveSpeakerView = true
        activeSpeakerButton.classList.remove('active')
    }else{
        activeSpeakerButton.classList.add('active')
        isActiveSpeakerView = false
        activeSpeakerContainer.click()
        activeSpeakerContainer = null;
        for (const uid in volList) {
            const container = document.getElementById(`user-container-${uid}`);
            if (!container) continue;
            container.style.height = '300px';
            container.style.width = '300px';
        }
    }
}

let leaveStream = async (e) => {
    e.preventDefault()

    document.getElementById('join-btn').style.display = 'block'
    document.getElementsByClassName('stream__actions')[0].style.display = 'none'

    for(let i = 0; localTracks.length > i; i++){
        localTracks[i].stop()
        localTracks[i].close()
    }

    await client.unpublish([localTracks[0], localTracks[1]])

    document.getElementById(`user-container-${uid}`).remove()

    if(userIdInDisplayFrame === `user-container-${uid}`){
        displayFrame.style.display = null

        for(let i = 0; videoFrames.length > i; i++){
            videoFrames[i].style.height = '300px'
            videoFrames[i].style.width = '300px'
        }
    }

    channel.sendMessage({text:JSON.stringify({'type':'user_left', 'uid':uid})})
}

document.getElementById('camera-btn').addEventListener('click', toggleCamera)
document.getElementById('mic-btn').addEventListener('click', toggleMic)
document.getElementById('active-speaker-btn').addEventListener('click', toggleActiveSpeaker)
document.getElementById('join-btn').addEventListener('click', joinStream)
document.getElementById('leave-btn').addEventListener('click', leaveStream)

joinRoomInit()