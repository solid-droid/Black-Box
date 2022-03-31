const vscode = require('vscode');
const fetch = require('node-fetch');
const env = require('./apiKeys');
const path = require('path');
const fs = require('fs');
const {HTMLToSlack, SlackToHtml} = require('./slackParser');
const gitExtension = vscode.extensions.getExtension('vscode.git').exports;
const { WebClient, LogLevel } = require("@slack/web-api");
const { performance } = require('perf_hooks');
var WebSocketClient = require('websocket').client;
/**
 * @param {vscode.ExtensionContext} context
 */
// tokens
let OPENAI_API_KEY = env.OPENAI_API_KEY;
let SLACK_TOKEN = env.SLACK_TOKEN;
let SLACK_SOCKET_TOKEN = env.SLACK_SOCKET_TOKEN;
let START_AUTO = false;
//webview
let currentPanel = null;
//slack
let client  = null;
let WSclient = null;
//blackbox
let currentThread = null;
let globalDocsThread = null;
let lastFilter = [];
let threadBuffer = {};
let threadIDref = {};
let channelCreationInProgress = false;
let updateLiveDocInProgress = false;
let repoCreated = false;
//codebase
let gitRepo = null;
let userName = null;
let rootPath = null;
//statusBar
let statusBarItem = null;
let showOnce = false;

//timers
let currenTime = performance.now();

const comandCenter = {
	"sendMessage": data => slack_sendMessage(data.message , data.channel , data.thread),
	"tag_best" : () => loadThread(currentThread.threadName, ['#best']),
	"tag_doc" : () => loadThread(currentThread.threadName, ['#doc','#globalDoc']),
	"loadAll" : () => loadThread(currentThread.threadName, []),
	"openSettings" : () => vscode.commands.executeCommand('workbench.action.openSettings', 'black-box'),
	"solved" : (data) => solvedHelpItem(data.ts),
	"openFile" : (data) => openFile(data.file),
}

async function activate(context) {
	const settings = vscode.workspace.getConfiguration('black-box');
	OPENAI_API_KEY = settings.get('OPENAI_API_KEY').toString() === '' ? env.OPENAI_API_KEY : settings.get('OPENAI_API_KEY').toString();
	SLACK_TOKEN = settings.get('SLACK_TOKEN').toString() === '' ? env.SLACK_TOKEN : settings.get('SLACK_TOKEN').toString();
	SLACK_SOCKET_TOKEN = settings.get('SLACK_SOCKET_TOKEN').toString() === '' ? env.SLACK_SOCKET_TOKEN : settings.get('SLACK_SOCKET_TOKEN').toString();
	userName = settings.get('SLACK_USER_NAME').toString() === '' ? '_user_' : settings.get('SLACK_USER_NAME').toString();
	START_AUTO = settings.get('START_AUTO') == false ? false : settings.get('START_AUTO');
	vscode.workspace.onDidChangeConfiguration(async (event) => {
		const answer = await vscode.window.showInformationMessage(
			`Black Box : Settings changed, please reload extension`,
			 "Reload",
			);
		if(answer === "Reload"){
			vscode.commands.executeCommand("workbench.action.reloadWindow");
		}
	});
	client = new WebClient(SLACK_TOKEN ,{
		//   logLevel: LogLevel.DEBUG
		});
	WSclient = new WebSocketClient();
	const wsSocketDetails = await (await fetch('https://slack.com/api/apps.connections.open',{
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${SLACK_SOCKET_TOKEN}`,
		},
	})).json();

	WSclient.on('connect', function(connection) {
		connection.on('message', function(message) {
			if (message.type === 'utf8') {
				const msg = JSON.parse(message.utf8Data)?.payload?.event || null;
				let text = msg?.text || null;
				let ts = msg?.thread_ts || null;
				if(!text) {
					ts =msg?.previous_message?.thread_ts || null;
					text = msg?.previous_message?.text || null;
				}
				if(ts){
					updateThreadBuffer(ts);
				}
				
			}
		});
	});
	WSclient.connect(wsSocketDetails.url);

	let previousFile = null;
	vscode.workspace.onDidOpenTextDocument(async (file) => {
		if (currentPanel) {
			if(file.fileName){
				let fileName = file.fileName;
				if(fileName.substring(file.fileName.length - 4) === '.git') {
					fileName = file.fileName.substring(0, file.fileName.length - 4);
				}
				if(previousFile !== fileName){
					previousFile = fileName;
					await loadWebView(context);
				}
			}
		}
	})
	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.openLiveDoc', async () => {
		showOnce = false;
		START_AUTO = true;
		await loadWebView(context);
	}));

	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.openAIdescribe', async () => await OpenAIDescribe()));

	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.openStackoverflow', async () => await getStackOverflowResults()));

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
	statusBarItem.command = 'black-box.openLiveDoc';
	context.subscriptions.push(statusBarItem);
	statusBarItem.text = `$(symbol-function) BlackBox`;
	statusBarItem.show();

	context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(textSelected));

	if(START_AUTO){
		showOnce = false;
		await beginLiveDocs(context);
	}
}

async function loadWebView(context) {
	if(START_AUTO && !showOnce){
		await beginLiveDocs(context);
	}
	if(START_AUTO ){
		updateLiveDoc();
	}
}

async function textSelected(){
	// await OpenAIDescribe();
}

async function getRepoDetails(){
	await new Promise(resolve => setTimeout(resolve, 200));
	const api = await gitExtension.getAPI(1);
	const repo = api.repositories[0];
	// const repoName = repo.rootUri.fsPath.split('\\').slice(-1).pop();	
	const downstreamUri = repo?.state?.remotes[0]?.fetchUrl ?? null; 
	if(downstreamUri)
	{
		try{
			const url = downstreamUri.replace(/^https:\/\/github.com\/(.*)\.git$/, 'https://api.github.com/repos/$1');
			const json = await(await fetch(url)).json();
			const channel = `${json.owner.login.toLowerCase()}-${json.name.toLowerCase()}`
				gitRepo = {
				name:json.name, 
				owner:json.owner.login, 
				channel:channel
			};
		} catch(e){
			console.log('error with git fetch');
			console.log(e);
			vscode.window.showErrorMessage("Facing issue with fetching git repo details");
		}

	}
	return null
}

async function createHelpThread(force = false){
	await vscode.window.withProgress(
		{
		  location: vscode.ProgressLocation.Notification,
		  title: 'Black Box ',
		  cancellable: false,
		},
		async (progress, token) => {
			await progress.report({ message: 'updating threads' });
			threadName = 'Active Help';
			const thread = await findThread(threadName);
			if(thread){
				const threadMessages = await getThreadMessages(thread.ts, threadName, force);
				await updateHelpContent(threadMessages);
				await progress.report({ message: 'threads updated' });
				await new Promise(resolve => setTimeout(resolve, 1500));
			}
		});

}

async function updateHelpContent(threadMessages){
	files = threadMessages.filter(x => 
	  x.text!=='Bot:Thread Created' && 
	  x.text!=='Active Help' && 
	  x.text.includes('File:'))
	  .map(x => ({file : x.text.split('File:')[1], ts : x.ts , thread_ts: x.thread_ts}));
	postDataToExtension({
			command:'help',
			files:files,
	});
}
async function OpenAIDescribe(){
	let currOpenEditor = vscode.window.activeTextEditor;
	const content  = currOpenEditor?.document?.getText();
	const selection = currOpenEditor?.selection;
	let selectedContent = null;
	if(selection){
		selectedContent = currOpenEditor?.document?.getText(selection);
	}
	if(content && (selectedContent.trim() !== "") && (currenTime+1000 < performance.now())){
		currenTime = performance.now();
		statusBarItem.text = `$(loading~spin) OpenAI`;
		statusBarItem.show();
		const descritption = await describeCode(selectedContent);
		const text = descritption?.choices[0]?.text;
		postDataToExtension({command:'OpenAI', content:text});
		statusBarItem.text = `$(symbol-function) BlackBox`;
		statusBarItem.show();
	} else {
		vscode.window.showErrorMessage("OpenAI : please select a code segment and press ALT + M");
	}
}


async function getStackOverflowResults(){
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	let currOpenEditor = vscode.window.activeTextEditor;
	const content  = currOpenEditor?.document?.getText();
	const selection = currOpenEditor?.selection;
	let selectedContent = null;
	if(selection){
		selectedContent = currOpenEditor?.document?.getText(selection);
	}
	if(content && (selectedContent.trim() !== "")){
		const data = await(await fetch(
			`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=activity&q=
			${selectedContent}&site=stackoverflow&filter=withbody`	)).json();
		postDataToExtension({command:'StackOverflow', content:data});
	}
}

async function updateLiveDoc(){
	if(!updateLiveDocInProgress){
		updateLiveDocInProgress = true;
		let currOpenEditor = vscode.window.activeTextEditor;
		await new Promise(resolve => setTimeout(resolve, 200));
		if(currOpenEditor){
					filePath = currOpenEditor?.document?.fileName;
				}
				rootPath = filePath?.split(gitRepo.name)[0];
				const allow = await loadThread(filePath);
				if(allow){
					await createHelpThread();
					if(repoCreated){
						postDataToExtension({
							command:'channel', 
							channel: `#${gitRepo.channel}`,
						});
					}
				}
				updateLiveDocInProgress = false;
		}
}
async function postDataToExtension(message){
	if (!currentPanel) {
	  return;
	}
	currentPanel.webview.postMessage(message);
  }

async function beginLiveDocs(context){
	START_AUTO = true;
	await getRepoDetails();
	if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside);
      } else {
	 	currentPanel = vscode.window.createWebviewPanel(
		'docView1',
		'Live Documentation',
		vscode.ViewColumn.Beside, 
		{
			enableScripts: true,
		}
	  );

	  currentPanel.webview.html = getWebviewContent(context);

	  currentPanel.webview.onDidReceiveMessage(
        message => {
			comandCenter[message.command](message.data);
        },
        undefined,
        context.subscriptions
      );


	  currentPanel.onDidDispose(
		() => {
		  currentPanel = undefined;
		},
		undefined,
		context.subscriptions
	  );
	}
	updateLiveDoc();
}


function getWebviewContent(context) {
	const filePath = vscode.Uri.file(path.join(context.extensionPath,'template.html'));
	return fs.readFileSync(filePath.fsPath, 'utf8');
  }


async function describeCode(code){
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const engine = 'davinci-codex';
	const url = `https://api.openai.com/v1/engines/${engine}/completions`;
	code = `
	${code}
	"""
	describe the above code:
	`;
	return await (await fetch(url,{
		headers: {
		  'Authorization': `Bearer ${OPENAI_API_KEY}`,
		  'Content-Type': 'application/json'
		},
		body:JSON.stringify(
		 {
				prompt: code,
				temperature: 0,
				max_tokens: 170,
				top_p: 1.0,
				frequency_penalty: 0.0,
				presence_penalty: 0.0,
				stop: ["\"\"\""]
		  }),
			  method: 'POST',
		})).json();
}


////////////////---slack---////////////////////


async function findChannel(name) {
    try {
      const result = await client.conversations.list({
        token: SLACK_TOKEN,
      });
  
      for (const channel of result.channels) {
        if (channel.name === name) {
          conversationId = channel.id;
        return conversationId;
        }
      }
    }
    catch (error) {
      return null;
    }
  }

async function getHistory(channelId) {
    try {
        // Call the conversations.history method using WebClient
        const result = await client.conversations.history({
          channel: channelId,
        });      
        
		return result;
      }
      catch (error) {
        return null;
      }
}

async function getThreadMessages(threadID , threadName , force=false){
	if(threadBuffer[threadName].message && !force){
	   return threadBuffer[threadName].message;
	}
	try {
        const replies = await client.conversations.replies({
			channel: await getChannelID(gitRepo.channel),
			ts:threadID,
		});
		threadBuffer[threadName]['message'] = replies.messages;
		return threadBuffer[threadName].message;
      }
      catch (error) {
        return null;
      }
}

async function publishMessage(channelID, text , ts= undefined , mrkdwn = true) {
    try {
      const result = await client.chat.postMessage({
        token: SLACK_TOKEN,
        channel: channelID,
        text: text,
		thread_ts: ts,
		mrkdwn: mrkdwn,
      });
	  return result;
    }
    catch (error) {
      console.error(error);
    }
  }

async function checkThreadMessage(channelRepo , text){
	let rootMessages = await getHistory(channelRepo);
	rootMessages = rootMessages.messages
						.filter(message => message.thread_ts)
						.map(message => ({ts : message.ts , thread_ts : message.thread_ts, text : message.text}));
	const thread = rootMessages.find(message => message.text === text);
	await updateGlobalDocsThread(rootMessages , channelRepo);	
	return thread;
}

async function updateGlobalDocsThread(rootMessages , channelRepo = gitRepo.channel){
	const thread = rootMessages.find(message => message.text === 'Global Docs');
	if(thread){
		globalDocsThread = thread;
		threadBuffer['Global Docs'] = {thread};
		threadIDref[thread.thread_ts] = 'Global Docs';
	} else {
		const result = await publishMessage(channelRepo , 'Global Docs');
		await publishMessage(channelRepo , 'Bot:Thread Created' , result.ts);
	}
}

async function findThread(threadName){
	if(threadBuffer[threadName])
		return threadBuffer[threadName].thread;

	const channelRepo = await getChannelID(gitRepo.channel);
	if(channelRepo){
		let thread = await checkThreadMessage(channelRepo , threadName);
		if(thread){
			threadBuffer[threadName] = {thread};
			threadIDref[thread.thread_ts] = threadName;
			return threadBuffer[threadName].thread;
		}else{
			//CREATE THREAD
			const result = await publishMessage(channelRepo , threadName);
			await publishMessage(channelRepo , 'Bot:Thread Created' , result.ts);
			thread = await checkThreadMessage(channelRepo , threadName);
			threadBuffer[threadName] = {thread};
			threadIDref[thread.thread_ts] = threadName;
			return threadBuffer[threadName].thread;
		}
	} else {
		return undefined;
	}

}



async function createChannel(channelName) {
    try {
        const result = await client.conversations.create({
          name: channelName
        });
		return true;
      }
      catch (error) {
        return false;
      }
  }
async function updateThreadBuffer(threadID){
	//updatebuffer
	if(Object.keys(threadIDref).includes(threadID)){
		const msg = await getThreadMessages(threadID , threadIDref[threadID] , true);
		//current file/thread
		if(currentThread['threadID'] === threadID){
			updateThreadMsgOnScreen(msg , threadID);
		}

		if(threadIDref[threadID] === 'Active Help'){
			updateHelpContent(msg);
		}
	}
	
}
async function loadThread(filePath , filterTags = lastFilter){
	if(filePath){
		await new Promise(resolve => setTimeout(resolve, 100));
		lastFilter = filterTags;
		const fileName = filePath.split(new RegExp(gitRepo.name, 'i'))[1];
		if(fileName && gitRepo){
			const threadName = gitRepo.name+ fileName;
			const displayName = '...\\'+threadName.split('\\')[threadName.split('\\').length-1];
			currentThread = {threadName:threadName,displayName:displayName};
			postDataToExtension({
				command: 'thread',
				thread: threadName,
				displayName:displayName,
			})
			const thread = await findThread(threadName);
			if(thread){
				currentThread['threadID'] = thread.ts;
				const threadMessages = await getThreadMessages(thread.ts, threadName);
				updateThreadMsgOnScreen(threadMessages , thread.ts , filterTags);
				return true;
			}
		}
	} else {
		vscode.window.showErrorMessage("No File selected. Please select a file and press CTRL + m");
	}
	return false;
}

async function updateThreadMsgOnScreen(threadMessages , ts , filterTags = lastFilter){
	
	let msg = threadMessages.slice(1)
							.map(item => preProcessIncommingMessage(item));
	if(filterTags.length){
		msg = msg.filter(item => {
			for(const tag of filterTags){
				if(item.tags.includes(tag)){
					return true
				}
			};
		return false;								
		});
	}

	if(filterTags.includes('#globalDoc')){
		const globalThread = await getThreadMessages(globalDocsThread.ts , 'Global Docs');
		let globalDoc = globalThread.slice(1)
								.map(item => preProcessIncommingMessage(item));
		msg = [...globalDoc, ...msg.filter(item => !item.tags.includes('#globalDoc'))];
	}
	postDataToExtension({
		command: 'message',
		thread: ts,
		message: msg,
	});
}

function preProcessIncommingMessage(item){
	let user = item.text.split(':')[0];
	const msg = item.text.split(':').splice(1).join(':');
	let tags = new Set();
	item.text.includes('#help') ? tags.add('#help') : false;
	item.text.includes('#best') ? tags.add('#best') : false;
	item.text.includes('#doc') ? tags.add('#doc') : false;
	item.text.includes('#globalDoc') ? tags.add('#doc') : false;
	tags = [...tags];
	tags.forEach(tag => user = user.replaceAll(tag,''));

	return {
		text:SlackToHtml(msg),
		user:user,
		tags:tags
	}
}

async function getChannelID(channel){
	let channelRepo = await findChannel(channel);
	console.log(channelRepo , showOnce);
	if(!channelRepo && !showOnce){
		showOnce = true;
		if(!channelCreationInProgress){
			channelCreationInProgress = true;
			await createChannelRepo(channel);
			channelRepo = await findChannel(channel);
			channelCreationInProgress = false;
		}
	}
	if(channelRepo){
		repoCreated = true;
	}else{
		repoCreated = false;
	}
	return channelRepo;

}

async function slack_sendMessage(message){
	
	const channelRepo = await getChannelID(gitRepo.channel);
	if(channelRepo){
		if(currentThread){
			const user = userName || '_user_';
			await publishMessage(channelRepo , `${user}:${HTMLToSlack(message)}` , currentThread.threadID);
			if(message.includes('#globalDoc')){
				await publishMessage(channelRepo , `${user}:${HTMLToSlack(message)}` , globalDocsThread.ts);
			}
			if(message.includes('#help')){
			 const msg = 'File: '+currentThread.threadName;
			 const helpThread = await findThread('Active Help');
			 if(helpThread && !threadBuffer['Active Help'].message.find(item => item.text.includes(msg))){
				await publishMessage(channelRepo , `${user}:${HTMLToSlack(msg)}` , helpThread.ts);
			 }
			}
			await loadThread(currentThread.threadName);
		} else{
			vscode.window.showErrorMessage("No thread found ( To create thread => Select file Tab + Alt + M )");
		}
	}

}

async function createChannelRepo(channel){
	const answer = await vscode.window.showInformationMessage(
		`Slack : ${channel} channel not found` ,
		 "Create Channel",
		);
	if(answer === "Create Channel"){
		await vscode.window.withProgress(
			{
			  location: vscode.ProgressLocation.Notification,
			  title: 'Slack ',
			  cancellable: false,
			},
			async (progress, token) => {
				await progress.report({ message: ' Creating Repo Channel' });
				const result = await createChannel(channel);
				if(result){
					await progress.report({ message: ' Repo Channel Created :)' });
				} else {
					await progress.report({ message: ' Repo Channel not Created :(' });
				}
				await new Promise(resolve => setTimeout(resolve, 3000));
			});
	}
}


async function solvedHelpItem(msg){
	const ts = msg.split(',')[0];
	const thread_ts = msg.split(',')[1];
	try {
		const channelId = await getChannelID(gitRepo.channel);
		await client.chat.delete({
		  token: SLACK_TOKEN ,
		  channel: channelId,
		  ts: ts,
		  thread_ts: thread_ts,
		});
	  }
	  catch (error) {
		vscode.window.showErrorMessage("Some error occured while deleting help message");
		console.error(error);
	  }
	  await createHelpThread(true);
}

async function openFile(file){
	//delay for tab to be in focus
	await new Promise(resolve => setTimeout(resolve, 500));
	//open file
	vscode.workspace.openTextDocument(rootPath + file.trim()).then(doc => {
		vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, false);
	});
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}
