const vscode = require('vscode');
const fetch = require('node-fetch');
const env = require('./apiKeys');
const gitExtension = vscode.extensions.getExtension('vscode.git').exports;
/**
 * @param {vscode.ExtensionContext} context
 */
let currentPanel = undefined;
async function activate(context) {
	// openAITest();
	const list = await testGETdata();
	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.findDocs', async  () => await dropdown(list)));

	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.askQuestion', async  () => await askQuestion()));

	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.liveDocumentation', async () => await beginLiveDocs(context)));

	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.sendMessage', async () => await sendMessage()));

	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.openLiveDoc', async () => await beginLiveDocs(context)));

	context.subscriptions.push(vscode.commands.registerCommand(
	'black-box.refreshLiveDoc', async () => await updateLiveDoc()));
}

async function getRepoDetails(){
	const api = gitExtension.getAPI(1);
	const repo = api.repositories[0];
	const downstreamUri = repo?.state.remotes[0].fetchUrl ?? null; 
	if(downstreamUri)
	{
		const url = downstreamUri.replace(/^https:\/\/github.com\/(.*)\.git$/, 'https://api.github.com/repos/$1');
		const response = await fetch(url);
		const json = await response.json();
		console.log(json);
	}
	
}

async function updateLiveDoc(){

	getRepoDetails();

	let currOpenEditor = vscode.window.activeTextEditor;
	
	const filePath = currOpenEditor?.document?.fileName;
	const content  = currOpenEditor?.document?.getText();
	const selection = currOpenEditor?.selection;
	let selectedContent = null;
	if(selection){
		selectedContent = currOpenEditor?.document?.getText(selection);
	}
	if(content){
		const descritption = await describeCode(selectedContent);
		// console.log(descritption?.choices[0]?.text);
	} else {
		vscode.window.showErrorMessage("please select a file");
	}

}
async function sendMessage(){
	console.log(currentPanel);
	if (!currentPanel) {
	  return;
	}
	currentPanel.webview.postMessage({ command: 'refactor' });
  }

async function beginLiveDocs(context){
	if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.One);
      } else {
	 currentPanel = vscode.window.createWebviewPanel(
		'docView1',
		'Live Documentation',
		vscode.ViewColumn.Beside, 
		{
			enableScripts: true,
		}
	  );

	  currentPanel.webview.html = getWebviewContent();

	  currentPanel.webview.onDidReceiveMessage(
        message => {
          console.log(message);
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
}



function getWebviewContent() {
	return `<!DOCTYPE html>
  <html lang="en">
  <head>
	  <meta charset="UTF-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <title>Cat Coding</title>
  </head>
  <body>
	  <img src="https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif" width="300" />
	  <h1 id="lines-of-code-counter">0</h1>
  
	  <script>
	  	  const vscode = acquireVsCodeApi();
		  const counter = document.getElementById('lines-of-code-counter');
  
		  let count = 0;
		  setInterval(() => {
			  counter.textContent = count++;
			//   vscode.postMessage({
			// 	  	count
			// });
		  }, 1000);
  
		  // Handle the message inside the webview
		  window.addEventListener('message', event => {
				console.log(event.data);
			  const message = event.data; // The JSON data our extension sent
  
			  switch (message.command) {
				  case 'refactor':
					  count = 0;
					  counter.textContent = count;
					  break;
			  }
		  });
	  </script>
  </body>
  </html>`;
  }

async function dropdown(list){
	const pick = await vscode.window.showQuickPick(list , {matchOnDetail: true});
	if(pick){
	vscode.window.showInformationMessage(`Hello ${pick.label}`);
	}
}

async function askQuestion(){
	const answer = await vscode.window.showInformationMessage(
		`How was your day` ,
		 "good",
		 "bad"
		);
	if(answer === "good"){
		vscode.window.showInformationMessage("Good");
	}else if(answer === "bad"){
		vscode.window.showInformationMessage("Bad");
	}else{
		vscode.window.showInformationMessage("No answer");
	}
}

async function openAITest(){
		const code = `
	let a = [1,2,3,4,5];
	a.sort((a,b) => a-b);
	console.log(a);`

	const descritption = await describeCode(code);
  	console.log(descritption?.choices[0]?.text);
}

async function describeCode(code){
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const OPENAI_API_KEY = env.OPENAI_API_KEY;
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
				max_tokens: 64,
				top_p: 1.0,
				frequency_penalty: 0.0,
				presence_penalty: 0.0,
				stop: ["\"\"\""]
		  }),
			  method: 'POST',
		})).json();
}

async function testGETdata(){
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const testdata = await (await fetch('http://jsonplaceholder.typicode.com/users')).json();
	return testdata.map(user => ({
		label: user.name,
		detail: user.username,
		data: user
	}));
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}
