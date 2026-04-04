const props = PropertiesService.getScriptProperties();
const SLACK_TOKEN = props.getProperty('SLACK_TOKEN');
const SPREADSHEET_ID = props.getProperty('SPREADSHEET_ID');

function doPost(e) {
  let json;
  if (e.postData && e.postData.contents) {
    try {
      json = JSON.parse(e.postData.contents);
    } catch (err) {}
  }

  if (json && json.type === "url_verification") {
    return ContentService.createTextOutput(json.challenge);
  }
  
  if (json && json.event) {
    const event = json.event;

    if (event.bot_id) return ContentService.createTextOutput("");
    
    const text = event.text ? event.text.trim().toLowerCase() : "";
    if (event.thread_ts && (text === "取り消し")) {
      return handleReplyDelete(event);
    }
    return ContentService.createTextOutput("");
  }

  // --- B. Slash Command (/tk ...) ---
  if (e.parameter && e.parameter.command) {
    return handleSlashCommand(e.parameter);
  }

  return ContentService.createTextOutput("");
}

function handleReplyDelete(event) {
  const channelId = event.channel;
  const threadTs = event.thread_ts; 
  const execUserId = event.user;
  const execUserName = getUserName(execUserId);

 
  const res = UrlFetchApp.fetch(`https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=1`, {
    "headers": { "Authorization": "Bearer " + SLACK_TOKEN }
  });
  const resData = JSON.parse(res.getContentText());
  if (!resData.ok || resData.messages.length === 0) return ContentService.createTextOutput("");
  
  const parentMessage = resData.messages[0];
  const originalText = parentMessage.text;

  //二重に取り消さないようにする
  if (originalText.includes("この投稿は取り消されました")) {
    return ContentService.createTextOutput("");
  }

  UrlFetchApp.fetch("https://slack.com/api/chat.update", {
    "method": "post",
    "headers": { "Authorization": "Bearer " + SLACK_TOKEN },
    "contentType": "application/json",
    "payload": JSON.stringify({
      "channel": channelId,
      "ts": threadTs,
      "text": `~この投稿は取り消されました~`
    })
  });

  UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", {
    "method": "post",
    "headers": { "Authorization": "Bearer " + SLACK_TOKEN },
    "contentType": "application/json",
    "payload": JSON.stringify({
      "channel": channelId,
      "thread_ts": threadTs, 
      "text": `🗑️ *無効化ログ*\n実行者: ${execUserName}\n元内容: \` ${originalText.replace(/\n/g, " / ")} \``
    })
  });

  return ContentService.createTextOutput("");
}



function handleSlashCommand(params) {
  const userId = params.user_id;
  const roomId = params.text.trim();
  const channelId = params.channel_id;
  const realName = getUserName(userId);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = ss.getSheetByName("index").getRange("B1").getValue();
  const sheet = ss.getSheetByName(sheetName);
  const data = sheet.getRange("A1:D25").getValues();
  const row = data.find(r => r[0].toString() === roomId);
  
  if (!row) return ContentService.createTextOutput("未登録:" + roomId);

  const now = new Date();
  const currentTimeStr = Utilities.formatDate(now, "JST", "HH:mm");
  let scheduledTimeStr = "";
  let diffMin = 0;

  if (row[3] instanceof Date) {
    scheduledTimeStr = Utilities.formatDate(row[3], "JST", "HH:mm");
    const scheduledDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), row[3].getHours(), row[3].getMinutes());
    diffMin = Math.floor((now - scheduledDate) / 60000);
  } else {
    scheduledTimeStr = row[3].toString();
    const parts = scheduledTimeStr.split(":");
    if (parts.length === 2) {
      const scheduledDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(parts[0]), Number(parts[1]));
      diffMin = Math.floor((now - scheduledDate) / 60000);
    }
  }

  // idがxxxの時だけ「開始時刻」ではなく、「終了時刻」と表示
  const timeLabel = (roomId === "xxx") ? "終了時刻" : "開始時刻";
  const statusText = diffMin > 0 ? `${diffMin}分押し` : diffMin < 0 ? `${Math.abs(diffMin)}分巻き` : "定刻通り";

  const z = "\u200B"; 
  const messageText = `実行者: ${realName}\n` +
                      `*〈${row[2]}〉* ${row[1]}\n` + 
                      `予定時刻:${z}${scheduledTimeStr}\n` +
                      `${timeLabel}:${z}${currentTimeStr}\n` +
                      `全体:${statusText}`;

  UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", {
    "method": "post",
    "headers": { "Authorization": "Bearer " + SLACK_TOKEN },
    "contentType": "application/json",
    "payload": JSON.stringify({ "channel": channelId, "text": messageText })
  });

  return ContentService.createTextOutput("");
}

function getUserName(userId) {
  try {
    const response = UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${userId}`, {
      "headers": { "Authorization": "Bearer " + SLACK_TOKEN }
    });
    const res = JSON.parse(response.getContentText());
    return res.ok ? (res.user.profile.display_name || res.user.profile.real_name) : userId;
  } catch (e) { return userId; }
}

// 権限を与えるために導入前にこれを一度実行する。
// //test
// function testPermit() {
//   SpreadsheetApp.openById("スプシのID").getSheetByName("シートの名前");
// }