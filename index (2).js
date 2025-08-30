"use strict";
const express = require("express");
let app = express();
const cluster = require("cluster");
const os = require("os");
const compression = require("compression");
const numClusters = os.cpus().length;
if (cluster.isMaster) {
  for (let i = 0; i < numClusters; i++) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => {
    cluster.fork();
  });
} else {
  app.use(compression());
  app.listen(3000, () => {
    console.log(`Worker ${process.pid} started`);
  });
}

const axios = require('axios');
const bodyParser = require("body-parser");
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const fs = require('fs');
const FormData = require('form-data');
const https = require('https');
const ytsr = require('ytsr');

const PORT = 3000;

app.use(bodyParser.json());

const CHATWORK_API_TOKEN = process.env.CHATWORK_API_TOKEN;
const geminiAPIKey = process.env.GEMINI_API;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; 
const wakametube = process.env.wakametube; 
const supabase = createClient(supabaseUrl, supabaseKey);

const zalgoPattern = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/;

//コマンドリスト
const commands = {
  "help": wakamehelp,
  "youtube": getwakametube,
  "ai": generateAI,
  "say": say,
  "おみくじ": komikuji,
  "save": save,
  "delete": deleteData,
  "setting": Settings,
  "member": RandomMember,
  "画像送ってみて": sendFile,
  "admin": addAdmin,
  "deladmin": removeAdmin,
  "adminlist": gijiAdminList,
  "kick": kickMember,
  "welcome": welcomesave,
  "welcomedelete": welcomedelete
};

app.get('/', (req, res) => {
    res.sendStatus(200);
});
//エンドポイント
app.post("/webhook", async (req, res) => {
  const accountId = req.body.webhook_event.from_account_id;
  const roomId = req.body.webhook_event.room_id;
  const messageId = req.body.webhook_event.message_id;
  const body = req.body.webhook_event.body;  
  const message = body.replace(/\[To:\d+\]ゆずbotさん|\/.*?\/|\s+/g, "");
  
  if (body.includes("/削除/")) {
    await deleteMessages(body, message, messageId, roomId, accountId);
    return res.sendStatus(200);
  }
  
  if (body.includes("[rp aid=9884448")) {
    return res.sendStatus(200);
  }
  
  if (body.includes("[To:all]")) {
    return res.sendStatus(200);
  }
  
  const command = getCommand(body);
  if (command && commands[command]) {
    await commands[command](body, message, messageId, roomId, accountId);
  } else if (command) {
    await sendchatwork(
      `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n存在しないコマンドです`,
      roomId
    );
  } else {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nこんにちはー。`, roomId);
  }
  
  res.sendStatus(200);
});
//全てのメッセージを受け取ります
app.post("/getchat", async (req, res) => {
  console.log(req.body);

  const body = req.body.webhook_event.body;
  const message = req.body.webhook_event.body;
  const accountId = req.body.webhook_event.account_id;
  const roomId = req.body.webhook_event.room_id;
  const messageId = req.body.webhook_event.message_id;
  
  if (accountId === 9884448) {
    return res.sendStatus(200);
  }
  
  if (body.includes("[To:9884448]")) {
    return res.sendStatus(200);
  }
  
  if (body.includes("/kick/")) {
    await kickMembers(body, message, messageId, roomId, accountId);
    return res.sendStatus(200);
  }
  
  if ((body.match(/\)/g) || []).length >= 30) {
    await blockMembers(body, message, messageId, roomId, accountId);
  }
  if ((body.match(/all/g) || []).length >= 10) {
      await blockMembers(body, message, messageId, roomId, accountId);
  }
  if ((body.match(/To:/g) || []).length >= 35) {
      await blockMembers(body, message, messageId, roomId, accountId);
  }
  const zalgoCount = (body.match(zalgoPattern) || []).length;
  if (zalgoCount >= 18) {
    await blockMembers(body, message, messageId, roomId, accountId);
  }

  if (message === "おみくじ") {
    await omikuji(body, message, messageId, roomId, accountId);
    return res.sendStatus(200);
  }
  
  if (/^\[info\]\[title\]\[dtext:chatroom_chat_edited\]\[\/title\]\[dtext:chatroom_member_is\]\[piconname:\d+\]\[dtext:chatroom_added\]\[\/info\]$/.test(message)) {
    await welcome(body, message, messageId, roomId, accountId);
    return res.sendStatus(200);
  }

  const { data, error } = await supabase
    .from('text')
    .select('triggerMessage, responseMessage')
    .eq('roomId', roomId);

  if (error) {
    console.error('Supabaseエラー:', error);
    return res.sendStatus(500);
  }

  const matchedData = data.find(item => message === item.triggerMessage);

  if (matchedData) {
    const responseMessage = matchedData.responseMessage;

    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n${responseMessage}`, roomId);

    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

//メッセージ送信
async function sendchatwork(ms, CHATWORK_ROOM_ID) {
  try {
    await axios.post(
      `https://api.chatwork.com/v2/rooms/${CHATWORK_ROOM_ID}/messages`,
      new URLSearchParams({ body: ms }),
      {
        headers: {
          "X-ChatWorkToken": CHATWORK_API_TOKEN,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    console.log("メッセージ送信成功");
  } catch (error) {
    console.error("Chatworkへのメッセージ送信エラー:", error.response?.data || error.message);
  }
}
//コマンド
function getCommand(body) {
  const pattern = /\/(.*?)\//;
  const match = body.match(pattern);
  return match ? match[1] : null;
}

//利用者データ取得
async function getChatworkMembers(roomId) {
  try {
    const response = await axios.get(
      `https://api.chatwork.com/v2/rooms/${roomId}/members`,
      {
        headers: {
          "X-ChatWorkToken": CHATWORK_API_TOKEN,
        },
      }
    );

    const members = response.data;
    return members;
  } catch (error) {
    console.error(
      "Error fetching Chatwork members:",
      error.response?.data || error.message
    );
    return null;
  }
}

async function getSenderName(accountId, roomId) {
  const members = await getChatworkMembers(roomId);
  if (members) {
    const sender = members.find((member) => member.account_id === accountId);
    console.log(sender);
    return sender ? sender.name : "名前を取得できませんでした";
  }
  return "chatworkユーザー";
}

//管理者ですか？
async function isUserAdmin(accountId, roomId) {
  try {
    const response = await axios.get(`https://api.chatwork.com/v2/rooms/${roomId}/members`, {
      headers: {
        'X-ChatWorkToken': CHATWORK_API_TOKEN
      }
    });
    const member = response.data.find(m => m.account_id === accountId);

    if (member && member.role === 'admin') {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('エラーが発生しました:', error);
    return false;
  }
}

//Help
async function wakamehelp(body, message, messageId, roomId, accountId) {
  await sendchatwork(
    `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん[info][title]ヘルプ[/title]/help/\nコマンドリストを表示します。\n/youtube/\nYouTubeのurlを一緒に送ることでストリームURLを表示してくれます。\n/ai/\nAIと一緒におはなし出来ます。[/info]`,
    roomId
  );
}

//gemini
async function generateAI(body, message, messageId, roomId, accountId) {
  try {
    message = "あなたはトークルーム「サメックス」のボットのゆずbotです。以下のメッセージに対して200字以下で返答して下さい:" + message;
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiAPIKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: message,
              },
            ],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const responseContent = response.data.candidates[0].content;
    let responseParts = responseContent.parts.map((part) => part.text).join("\n");
    responseParts = responseParts.replace(/\*/g, "");

    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n${responseParts}`, roomId);
  } catch (error) {
    console.error('エラーが発生しました:', error.response ? error.response.data : error.message);

    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラーが発生しました。`, roomId);
  }
}

//say
async function say(body, message, messageId, roomId, accountId) {
    sendchatwork(message, roomId);
}

//おみくじ
async function omikuji(body, message, messageId, roomId, accountId) {
    const results = [
        { fortune: "ゆず！" },
        { fortune: "極大吉" },
        { fortune: "超大吉" },
        { fortune: "大吉" },
        { fortune: "中吉" },
        { fortune: "小吉" },
        { fortune: "末吉" },
        { fortune: "凶" },
        { fortune: "大凶" },
        { fortune: "---深刻なエラーが発生しました---" }
    ];

    const probabilities = [
        { fortuneIndex: 0, probability: 0.003 },
        { fortuneIndex: 1, probability: 0.10 },
        { fortuneIndex: 2, probability: 0.10 },
        { fortuneIndex: 3, probability: 0.40 },
        { fortuneIndex: 4, probability: 0.10 },
        { fortuneIndex: 5, probability: 0.08 },
        { fortuneIndex: 6, probability: 0.07 },
        { fortuneIndex: 7, probability: 0.07 },
        { fortuneIndex: 8, probability: 0.07 },
        { fortuneIndex: 9, probability: 0.007 }
    ];
  
    const today = DateTime.now().setZone('Asia/Tokyo').toFormat('yyyy-MM-dd');
  
    const { data, error } = await supabase
        .from('omikuji_log')
        .select('*')
        .eq('accountId', accountId)
        .eq('roomId', roomId)
        .eq('date', today)
        .single();

    if (error) {
        console.error('Supabaseエラー:', error);
    }

    if (data) {
        const ms = `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n今日はもうおみくじを引いています！明日また挑戦してね！`;
        sendchatwork(ms, roomId);
        return;
    }

    const rand = Math.random();
    let cumulativeProbability = 0;
    let resultIndex = 0;

    for (const prob of probabilities) {
        cumulativeProbability += prob.probability;
        if (rand < cumulativeProbability) {
            resultIndex = prob.fortuneIndex;
            break;
        }
    }

    const result = results[resultIndex];
    const ms = `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n${result.fortune}`;
    const { data: insertData, error: insertError } = await supabase
        .from('omikuji_log')
        .insert([
            { accountId: accountId, date: today, roomId: roomId}
        ]);
    sendchatwork(ms, roomId);

    if (insertError) {
        console.error('Supabase保存エラー:', insertError);
    } else {
        console.log('おみくじ結果が保存されました:', insertData);
    }
}

//おみくじ(貫通用)
async function komikuji(body, message, messageId, roomId, accountId) {
    const results = [
        { fortune: "ゆず！" },
        { fortune: "極大吉" },
        { fortune: "超大吉" },
        { fortune: "大吉" },
        { fortune: "中吉" },
        { fortune: "小吉" },
        { fortune: "末吉" },
        { fortune: "凶" },
        { fortune: "大凶" },
        { fortune: "---深刻なエラーが発生しました---" }
    ];

    const probabilities = [
        { fortuneIndex: 0, probability: 0.003 },
        { fortuneIndex: 1, probability: 0.10 },
        { fortuneIndex: 2, probability: 0.10 },
        { fortuneIndex: 3, probability: 0.40 },
        { fortuneIndex: 4, probability: 0.10 },
        { fortuneIndex: 5, probability: 0.08 },
        { fortuneIndex: 6, probability: 0.07 },
        { fortuneIndex: 7, probability: 0.07 },
        { fortuneIndex: 8, probability: 0.07 },
        { fortuneIndex: 9, probability: 0.007 }
    ];

    const rand = Math.random();
    let cumulativeProbability = 0;
    let resultIndex = 0;

    for (const prob of probabilities) {
        cumulativeProbability += prob.probability;
        if (rand < cumulativeProbability) {
            resultIndex = prob.fortuneIndex;
            break;
        }
    }

    const result = results[resultIndex];
    const ms = `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n${result.fortune}`;

    sendchatwork(ms, roomId);
  
}

//トリガー保存
async function save(body, message, messageId, roomId, accountId) {
  
  const match = message.match(/^([^「]+)「(.+)」$/);
  const triggerMessage = match[1];
  const responseMessage = match[2];
  
  if (!match) {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n構文エラー`, roomId);
    return;
  }
  
  const isAdmin = await checkAgijidmin(roomId, accountId);

  if (!isAdmin) {
    const isAdmin3 = await isUserAdmin(accountId, roomId);
    if (!isAdmin3) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }
  }
  
  const { data, error } = await supabase
    .from('text')
    .insert([
      { roomId: roomId,
        triggerMessage: triggerMessage,
        responseMessage: responseMessage 
      }
    ]);

  if (error) {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nデータを保存できませんでした`, roomId);
  } else {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nデータを保存しました！`, roomId);
  }
}

//トリガー削除
async function deleteData(body, triggerMessage, messageId, roomId, accountId) {
  
  const isAdmin = await checkAgijidmin(roomId, accountId);

  if (!isAdmin) {
    const isAdmin3 = await isUserAdmin(accountId, roomId);
    if (!isAdmin3) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }
  }
  
  const { data, error } = await supabase
    .from('text')
    .delete()
    .eq('roomId', roomId)
    .eq('triggerMessage', triggerMessage);

  if (error) {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n削除しようとしているデータが見つかりません。settingコマンドを使って保存中のデータを閲覧できます。`, roomId);
  } else {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n削除しました`, roomId);
  }
}

//設定閲覧
async function Settings(body, triggerMessage, messageId, roomId, accountId) {
  const { data, error } = await supabase
    .from('text')
    .select('triggerMessage, responseMessage')
    .eq('roomId', roomId);

  if (error) {
    console.error('設定取得エラー:', error);
  } else {
    if (data.length === 0) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nこのルームに設定されたメッセージはありません`, roomId);
    } else {
      let messageToSend = `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん[info][title]設定されたメッセージ[/title]`;
      data.forEach(item => {
        messageToSend += `${item.triggerMessage} - ${item.responseMessage}\n`;
      });
      
      messageToSend += "[/info]"
      await sendchatwork(messageToSend, roomId);
    }
  }
}

//利用者ランダム表示
async function RandomMember(body, triggerMessage, messageId, roomId, accountId) {
  try {
    const members = await getChatworkMembers(roomId);

    if (!members || members.length === 0) {
      return;
    }

    const randomIndex = Math.floor(Math.random() * members.length);
    const randomMember = members[randomIndex];

    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n[piconname:${randomMember.account_id}]さんが選ばれました！`, roomId);
  } catch (error) {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー。あらら`, roomId);
  }
}

//ようこそメッセージ！
async function welcome(body, message, messageId, roomId, accountId) {
  const welcomeId = (message.match(/\[piconname:(\d+)\]/) || [])[1];
  
  const { data, error } = await supabase
    .from('welcome')
    .select('roomId, welcomems')
    .eq('roomId', roomId)
    .order('id', { ascending: false })
    .limit(1);
  console.log(data);
  
  if (error) {
    console.error('Supabaseエラー:', error);
    return;
  }
  
  if (!data) { 
    console.log('データなし');
    return; 
  } else {
   const wlMessage = data[0].welcomems;
   console.log(wlMessage);
   const welwel = wlMessage.replace(/<br>/g, '\n');
   if (welwel) {
     await sendchatwork(
       `[rp aid=${welcomeId} to=${roomId}-${messageId}][pname:${welcomeId}]さん\n${welwel}`,
       roomId
     );
   }
  }
}

//設定＆編集
async function welcomesave(body, message, messageId, roomId, accountId) {
  const n = body.replace(/\n/g, '<br>');
  console.log(n);
  const pattern = /\{(.*?)\}/;
  const m = n.match(pattern);
  const wlMessage = m[1];
  if (!wlMessage) {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n構文エラー`, roomId);
    return;
  }
  
  const isAdmin = await checkAgijidmin(roomId, accountId);

  if (!isAdmin) {
    const isAdmin3 = await isUserAdmin(accountId, roomId);
    if (!isAdmin3) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }
  }
  
  const { checkdata, error } = await supabase
      .from('welcome')
      .select('roomId, welcomems')
      .eq('roomId', roomId)
      .order('created_at', { ascending: false })
      .limit(1);
  
  if (!checkdata) {
   const { data, createrror } = await supabase
    .from('welcome')
    .insert([
      { roomId: roomId,
        welcomems: wlMessage,
      }
  ]);
   if (createrror) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nようこそメッセージを保存できませんでした`, roomId);
     return;
    } else {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nようこそメッセージを保存しました！`, roomId);
      return;
    }
  } else{
      const { error: updateError } = await supabase
      .from('welcome')
      .update({welcomems: wlMessage})
      .eq('roomId', roomId);
    
    if (updateError) {
        await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nようこそメッセージを編集できませんでした`, roomId);
    } else {
        await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nようこそメッセージを編集しました！`, roomId);
    }
    return;
  }
  return;
}

//ようこそ削除
async function welcomedelete(body, triggerMessage, messageId, roomId, accountId) {
  
  const isAdmin = await checkAgijidmin(roomId, accountId);

  if (!isAdmin) {
    const isAdmin3 = await isUserAdmin(accountId, roomId);
    if (!isAdmin3) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }
  }
  
  const { data, error } = await supabase
    .from('welcome')
    .delete()
    .eq('roomId', roomId);

  if (error) {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n削除しようとしているデータが見つかりません。`, roomId);
  } else {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n削除しました`, roomId);
  }
}

//荒らし対策
async function blockMembers(body, message, messageId, roomId, accountIdToBlock) {
  try {
    const isAdmin = await isUserAdmin(accountIdToBlock, roomId);

    if (isAdmin) {
      return;
    }
  
    const members = await getChatworkMembers(roomId);

    let adminIds = [];
    let memberIds = [];
    let readonlyIds = [];

    members.forEach(member => {
      if (member.role === 'admin') {
        adminIds.push(member.account_id);
      } else if (member.role === 'member') {
        memberIds.push(member.account_id);
      } else if (member.role === 'readonly') {
        readonlyIds.push(member.account_id);
      }
    });

    if (!readonlyIds.includes(accountIdToBlock)) {
      readonlyIds.push(accountIdToBlock);
    }

    adminIds = adminIds.filter(id => id !== accountIdToBlock);
    memberIds = memberIds.filter(id => id !== accountIdToBlock);

    const encodedParams = new URLSearchParams();
    encodedParams.set('members_admin_ids', adminIds.join(','));
    encodedParams.set('members_member_ids', memberIds.join(','));
    encodedParams.set('members_readonly_ids', readonlyIds.join(','));

    const url = `https://api.chatwork.com/v2/rooms/${roomId}/members`;
    const response = await axios.put(url, encodedParams.toString(), {
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-chatworktoken': CHATWORK_API_TOKEN,
      },
    });
    await sendchatwork(`[info][title]不正利用記録[/title][piconname:${accountIdToBlock}]さんに対して、不正利用フィルターが発動しました。[/info]`, roomId);

  } catch (error) {
    console.error('不正利用フィルターエラー:', error.response ? error.response.data : error.message);
  }
}

//任意の荒らし対策
async function arasitaisaku(body, message, messageId, roomId, accountId) {
  try {
    const { data, error } = await supabase
      .from('arashi_rooms')
      .select('roomId')
      .eq('roomId', roomId);

    if (error) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー。`, roomId);
      return;
    }

    if (data.length === 0) {           
      const { error: insertError } = await supabase
        .from('arashi_rooms') 
        .insert([{ roomId: roomId }]);

      if (insertError) {
        await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー。設定の変更を保存できませんでした`, roomId);
        return;
      }
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nゆずbotによる不正利用フィルターをONにしました。`, roomId);
    } else {
      const { error: deleteError } = await supabase
        .from('arashi_rooms')
        .delete()
        .eq('roomId', roomId);

      if (deleteError) {
        await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー。設定の変更を保存できませんでした`, roomId);
        return;
      }
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nゆずbotによる不正利用フィルターをOFFにしました。`, roomId);
    }
  } catch (err) {
    console.error('エラー:', err);
  }
}

async function isUsermember(accountId, roomId) {
  try {
    const response = await axios.get(`https://api.chatwork.com/v2/rooms/${roomId}/members`, {
      headers: {
        'X-ChatWorkToken': CHATWORK_API_TOKEN
      }
    });
    const member = response.data.find(m => m.account_id.toString() === accountId.toString());
    if (member) {
      if (member.role === 'member') {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('エラーが発生しました:', error);
    return false;
  }
}

//権限再付与
async function retrust(body, message, messageId, roomId, accountId) {
  try {
    const isAdmin = await checkAgijidmin(roomId, accountId);

    if (!isAdmin) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }

    const accountIdToBlock = message;
    if (!accountIdToBlock) {
      return;
    }

    const isKickable = await isUsermember(accountIdToBlock, roomId);

    if (!isKickable) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: 管理者、または既に閲覧のみのユーザーはキックできません。`, roomId);
      return;
    }

    const members = await getChatworkMembers(roomId);

    let adminIds = [];
    let memberIds = [];
    let readonlyIds = [];

    members.forEach(member => {
      if (member.role === 'admin') {
        adminIds.push(member.account_id);
      } else if (member.role === 'member') {
        memberIds.push(member.account_id);
      } else if (member.role === 'readonly') {
        readonlyIds.push(member.account_id);
      }
    });
    if (!readonlyIds.includes(accountIdToBlock)) {
      readonlyIds.push(accountIdToBlock);
    }

    adminIds = adminIds.filter(id => id !== accountIdToBlock);
    memberIds = memberIds.filter(id => id !== accountIdToBlock);

    const encodedParams = new URLSearchParams();
    encodedParams.set('members_admin_ids', adminIds.join(','));
    encodedParams.set('members_member_ids', memberIds.join(','));
    encodedParams.set('members_readonly_ids', readonlyIds.join(','));

    const url = `https://api.chatwork.com/v2/rooms/${roomId}/members`;
    await axios.put(url, encodedParams.toString(), {
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-chatworktoken': CHATWORK_API_TOKEN,
      },
    });

    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n[piconname:${accountIdToBlock}]さんをキックしました。`, roomId);

  } catch (error) {
    console.error('エラー:', error.response ? error.response.data : error.message);
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラーが発生しました。詳細: ${error.message}`, roomId);
  }
}


//キック機能
async function kickMembers(body, message, messageId, roomId, accountId) {
  try {
    const isAdmin = await checkAgijidmin(roomId, accountId);

    if (!isAdmin) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }

    const accountIdToBlock = message.match(/aid=(\d+)/)?.[1];
    if (!accountIdToBlock) {
      return;
    }

    const isKickable = await isUsermember(accountIdToBlock, roomId);
    if (!isKickable) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: 管理者、または既に閲覧のみのユーザーはキックできません。`, roomId);
      return;
    }

    const members = await getChatworkMembers(roomId);

    let adminIds = [];
    let memberIds = [];
    let readonlyIds = [];

    members.forEach(member => {
      if (member.role === 'admin') {
        adminIds.push(member.account_id);
      } else if (member.role === 'member') {
        memberIds.push(member.account_id);
      } else if (member.role === 'readonly') {
        readonlyIds.push(member.account_id);
      }
    });

    if (!readonlyIds.includes(accountIdToBlock)) {
      readonlyIds.push(accountIdToBlock);
    }

    adminIds = adminIds.filter(id => id !== accountIdToBlock);
    memberIds = memberIds.filter(id => id !== accountIdToBlock);

    const encodedParams = new URLSearchParams();
    encodedParams.set('members_admin_ids', adminIds.join(','));
    encodedParams.set('members_member_ids', memberIds.join(','));
    encodedParams.set('members_readonly_ids', readonlyIds.join(','));

    const url = `https://api.chatwork.com/v2/rooms/${roomId}/members`;
    await axios.put(url, encodedParams.toString(), {
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-chatworktoken': CHATWORK_API_TOKEN,
      },
    });

    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n[piconname:${accountIdToBlock}]さんをキックしました。`, roomId);

  } catch (error) {
    console.error('エラー:', error.response ? error.response.data : error.message);
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラーが発生しました。詳細: ${error.message}`, roomId);
  }
}


//To kick
async function kickMember(body, message, messageId, roomId, accountId) {
  try {
    const isAdmin = await checkAgijidmin(roomId, accountId);

    if (!isAdmin) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }

    const accountIdToBlock = message;
    if (!accountIdToBlock) {
      return;
    }

    const isKickable = await isUsermember(accountIdToBlock, roomId);

    if (!isKickable) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: 管理者、または既に閲覧のみのユーザーはキックできません。`, roomId);
      return;
    }

    const members = await getChatworkMembers(roomId);

    let adminIds = [];
    let memberIds = [];
    let readonlyIds = [];

    members.forEach(member => {
      if (member.role === 'admin') {
        adminIds.push(member.account_id);
      } else if (member.role === 'member') {
        memberIds.push(member.account_id);
      } else if (member.role === 'readonly') {
        readonlyIds.push(member.account_id);
      }
    });
    if (!readonlyIds.includes(accountIdToBlock)) {
      readonlyIds.push(accountIdToBlock);
    }

    adminIds = adminIds.filter(id => id !== accountIdToBlock);
    memberIds = memberIds.filter(id => id !== accountIdToBlock);

    const encodedParams = new URLSearchParams();
    encodedParams.set('members_admin_ids', adminIds.join(','));
    encodedParams.set('members_member_ids', memberIds.join(','));
    encodedParams.set('members_readonly_ids', readonlyIds.join(','));

    const url = `https://api.chatwork.com/v2/rooms/${roomId}/members`;
    await axios.put(url, encodedParams.toString(), {
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-chatworktoken': CHATWORK_API_TOKEN,
      },
    });

    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n[piconname:${accountIdToBlock}]さんをキックしました。`, roomId);

  } catch (error) {
    console.error('エラー:', error.response ? error.response.data : error.message);
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラーが発生しました。詳細: ${error.message}`, roomId);
  }
}

//メッセージ削除
async function deleteMessages(body, message, messageId, roomId, accountId) {
  const dlmessageIds = [...message.matchAll(/(?<=to=\d+-)(\d+)/g)].map(match => match[0]);

  if (dlmessageIds.length === 0) {
    return;
  }

  for (let i = 0; i < dlmessageIds.length; i++) {
    const messageId = dlmessageIds[i];
    const url = `https://api.chatwork.com/v2/rooms/${roomId}/messages/${messageId}`;

    try {
      const response = await axios.delete(url, {
        headers: {
          'Accept': 'application/json',
          'x-chatworktoken': CHATWORK_API_TOKEN,
        }
      });

    } catch (err) {
      console.error(`メッセージID ${messageId} の削除中にエラーが発生しました:`, err.response ? err.response.data : err.message);
    }
  }
}

//擬似管理者システム
// 管理者を追加
async function addAdmin(body, message, messageId, roomId, accountId) {
  try {
    const isAdmin = await isUserAdmin(accountId, roomId);

    if (!isAdmin) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }
    const { data, error } = await supabase
      .from('room_admins')
      .select('accountId')
      .eq('roomId', roomId)
      .eq('accountId', message)
      .single();

    if (data) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n[piconname:${message}]さんはすでに管理者として登録されています`, roomId);
      return 'すでに登録されています';
    }

    const { insertData, insertError } = await supabase
      .from('room_admins')
      .insert([
        { roomId: roomId, accountId: message }
      ]);
    
    if (insertError) throw insertError;
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n[piconname:${message}]さんを管理者として登録しました`, roomId);
    return insertData;

  } catch (error) {
    console.error("Error adding admin:", error.message);
  }
}

// 管理者を削除
async function removeAdmin(body, message, messageId, roomId, accountId) {
  try {
    const isAdmin = await isUserAdmin(accountId, roomId);

    if (!isAdmin) {
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nエラー: この操作は管理者にしか行えません。`, roomId);
      return;
    }
    const { data, error } = await supabase
      .from('room_admins')
      .delete()
      .eq('roomId', roomId)
      .eq('accountId', message);
    
    if (error) throw error;
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\n[piconname:${message}]さんを管理者から削除しました`, roomId);
    return data;
  } catch (error) {
    console.error("Error removing admin:", error.message);
  }
}

// 擬似管理者かをチェック
async function checkAgijidmin(roomId, accountId) {
  try {
    const { data, error } = await supabase
      .from('room_admins') 
      .select('accountId')
      .eq('roomId', roomId)
      .eq('accountId', accountId)
      .single();
    
    if (error) {
      console.log("Admin check failed:", error.message);
      return false;
    }
    if (error) {
      return true;
    }
  } catch (error) {
    console.error("Error checking admin:", error.message);
    return false;
  }
}

//擬似管理者一覧
async function gijiAdminList(body, message, messageId, roomId, accountId) {
  try {
    const { data, error } = await supabase
      .from('room_admins')
      .select('accountId')
      .eq('roomId', roomId);

    if (error) {
      console.error('管理者リスト取得エラー:', error);
      return;
    }

    if (data.length === 0) {
      const noAdminMessage = `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nこのルームには管理者が設定されていません。`;
      await sendchatwork(noAdminMessage, roomId);
      return;
    }

    let messageToSend = `[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん[info][title]このルームの管理者一覧[/title]`;
    data.forEach(item => {
      messageToSend += `[piconname:${item.accountId}]\n`;
    });
    messageToSend += "[/info]";

    await sendchatwork(messageToSend, roomId);

  } catch (error) {
    console.error('管理者リスト送信中のエラー:', error.message);
  }
}


//画像送ってみよか
async function sendFile(body, message, messageId, roomId, accountId) {
  try {
    const localFilePath = 'tstfile';

    const writer = fs.createWriteStream(localFilePath);
    const response = await axios({
      method: 'get',
      url: "https://cdn.glitch.global/17268288-67ef-4f38-bc54-bd0c299f1e57/IMG_1111_Original.jpeg?v=1732982430878",
      responseType: 'stream',
    });
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const formData = new FormData();
    formData.append('file', fs.createReadStream(localFilePath));

    const uploadUrl = `https://api.chatwork.com/v2/rooms/${roomId}/files`;
    const headers = {
      ...formData.getHeaders(),
      'x-chatworktoken': CHATWORK_API_TOKEN,
    };

    const uploadResponse = await axios.post(uploadUrl, formData, { headers });

    fs.unlinkSync(localFilePath);
  } catch (error) {
    console.error('エラーが発生しました:', error.response ? error.response.data : error.message);
  }
}


//youtube
const YOUTUBE_URL = /(?:https?:\/\/)?(?:www\.)?youtu(?:\.be\/|be\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w\-]+)/;

async function getwakametube(body, message, messageId, roomId, accountId) {
  const ms = message.replace(/\s+/g, "");
  const regex = /「(.*?)」/;
  const matchid = ms.match(regex);
  if (matchid && matchid[1]) {
    try{
      const searchQuery = matchid[1];
      console.log(`検索クエリ: ${searchQuery}`);

     const videoId3 = await getFirstVideoId(searchQuery)
  　　　　.then(videoId => {
         return videoId;
         });
     console.log(videoId3);
     const response = await axios.get(`${wakametube}${videoId3}`,);
     const videoData = response.data;
      
     const streamUrl = videoData.streamUrl;
     const videoTitle = videoData.videoTitle;
     const sssl = videoData.sssl;
     
    if (streamUrl) {
      await sendMessageToChatwork(`${videoTitle}\n[code]${streamUrl}[/code]\nこちらのURLでも再生できるかもしれません\n[code]${sssl}[/code]`, messageId, roomId, accountId);
      await sendFileyt(roomId, videoId3, videoTitle)
      return;
    }
    }catch (error) {
    await sendMessageToChatwork("エラーが発生しました。", messageId, roomId, accountId);
    return;
  }
  }
  
  const match = ms.match(YOUTUBE_URL);

  if (match) {
    const videoId = match[1];

    try {
      const response = await axios.get(`${wakametube}${videoId}`,);
      const videoData = response.data;
      const streamUrl = videoData.streamUrl;
      const videoTitle = videoData.videoTitle;
      const sssl = videoData.sssl;
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}]\n${videoTitle}\n[code]${streamUrl}[/code]\nこちらのURLでも再生できるかもしれません\n[code]${sssl}[/code]`, roomId);
      await sendFileyt(roomId, videoId, videoTitle)
      return;
    } catch (error) {
      console.error("APIリクエストエラー:", error);
      await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nえらー。あらら。`, roomId);
      return;
    }
  } else {
    await sendchatwork(`[rp aid=${accountId} to=${roomId}-${messageId}][pname:${accountId}]さん\nURLが無効です。正しいYouTubeのURLを入力してください。`, roomId);
  }
  return;
}

function getFirstVideoId(query) {
    return ytsr(query)
        .then((searchResults) => {
            if (searchResults && searchResults.items && searchResults.items.length > 0) {
                const firstVideo = searchResults.items.find(item => item.type === 'video');
                if (firstVideo) {
                    return firstVideo.id;
                }
            }
            throw new Error('動画が見つかりませんでした');
        })
        .catch(error => {
            console.error('エラー:', error);
        });
}

async function sendMessageToChatwork(message, messageId, roomId, acId) {
  try {
    const ms = `[rp aid=${acId} to=${roomId}-${messageId}][pname:${acId}]さん\n${message}`;
    await axios.post(
      `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
      new URLSearchParams({ body: ms }),
      {
        headers: {
          "X-ChatWorkToken": CHATWORK_API_TOKEN,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    console.log("メッセージ送信成功");
  } catch (error) {
    console.error("Chatworkへのメッセージ送信エラー:", error.response?.data || error.message);
  }
}

async function sendFileyt(roomId, videoId, videoTitle) {
  try {
    const localFilePath = `${videoTitle}.jpg`;

    const writer = fs.createWriteStream(localFilePath);
    const response = await axios({
      method: 'get',
      url: `https://watawata.kameli.org/vi/${videoId}/maxresdefault.jpg`,
      responseType: 'stream',
    });
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const formData = new FormData();
    formData.append('file', fs.createReadStream(localFilePath));

    const uploadUrl = `https://api.chatwork.com/v2/rooms/${roomId}/files`;
    const headers = {
      ...formData.getHeaders(),
      'x-chatworktoken': CHATWORK_API_TOKEN,
    };

    const uploadResponse = await axios.post(uploadUrl, formData, { headers });

    fs.unlinkSync(localFilePath);
  } catch (error) {
    console.error('ファイル送信でエラーが発生しました');
  }
}