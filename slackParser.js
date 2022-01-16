function applyStringPrototype(){
    String.prototype.deentitize = function() {
        var ret = this.replace(/&gt;/g, '>');
        ret = ret.replace(/&lt;/g, '<');
        ret = ret.replace(/&quot;/g, '"');
        ret = ret.replace(/&apos;/g, "'");
        ret = ret.replace(/&amp;/g, '&');
        return ret;
    };
}

function HTMLToSlack(message, deentitize = false){
    applyStringPrototype();
    if(deentitize){
        message = message.deentitize();
    }
   //conver html message to slack markdown
    let slackMessage = message.replace(/<p>/g, '\n');
        slackMessage = slackMessage.replace(/<\/p>/g, '');
        slackMessage = slackMessage.replace(/<em>/g, '_');
        slackMessage = slackMessage.replace(/<\/em>/g, '_');
        slackMessage = slackMessage.replace(/<strong>/g, '*');
        slackMessage = slackMessage.replace(/<\/strong>/g, '*');
        slackMessage = slackMessage.replace(/<s>/g, '~');
        slackMessage = slackMessage.replace(/<\/s>/g, '~');
        slackMessage = slackMessage.replace(/<blockquote>/g, '>');
        slackMessage = slackMessage.replace(/<\/blockquote>/g, '\n');
        slackMessage = slackMessage.replace(/<pre class="ql-syntax" spellcheck="false">/g, '```');
        slackMessage = slackMessage.replace(/<\/pre>/g, '```');
        slackMessage = slackMessage.replace(/<br>/g, '\n');
        slackMessage = slackMessage.replace(/<\/br>/g, '\n');
        return slackMessage;
}
function SlackToHtml(message){
    //convert markdown message to html
    let html = '<p>'+message + '</p>';
    //new line using </p><p>
    html = html.replace(/\n/g, '</p><p>');
    //strike ~
    html = html.replace(/\~(.*?)\~/g, '<s>$1</s>');
    //bold *
    html = html.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    //italic _
    html = html.replace(/\_(.*?)\_/g, '<em>$1</em>');
    //code
    html = html.replace(/```(.*?)```/g, '<pre class="ql-syntax" spellcheck="false">$1</pre>');
    return html
}

module.exports = {
    HTMLToSlack,
    SlackToHtml
}