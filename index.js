  sock.ev.on('messages.upsert', async (up) => {
    let messages = up.messages;

    for (const m of messages) {
      try {
        if (m.key && m.key.id) {
          if (seenMsgIds.has(m.key.id)) {
            continue;
          }
          seenMsgIds.add(m.key.id);
          if (seenMsgIds.size > 1000) {
            seenMsgIds.clear();
          }
        }

        if (m.message?.reactionMessage) {
          continue;
        }
        if (m.message?.protocolMessage) {
          continue;
        }
        if (m.message?.pollUpdateMessage) {
          continue;
        }
        if (m.message?.senderKeyDistributionMessage) {
          continue;
        }
        if (m.messageStubType) {
          continue;
        }
        if (m.messageStubParameters) {
          continue;
        }
        if (!m.message) {
          continue;
        }
        if (m.messageTimestamp && (Date.now() / 1000 - m.messageTimestamp > 30)) {
          continue;
        }

        const from = m.key.remoteJid;
        const isGroup = from && from.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid;
        const senderPn = m.key.participantPn || sender;
        const senderLid = getNum(sender);

        if (senderPn && sender && senderPn !== sender) {
          linkLidToPhone(sender, senderPn);
        }

        const senderNum = resolvePhone(sender, senderPn);

        const text = m.message.conversation ||
          (m.message.extendedTextMessage && m.message.extendedTextMessage.text) ||
          (m.message.imageMessage && m.message.imageMessage.caption) ||
          (m.message.videoMessage && m.message.videoMessage.caption) ||
          '';

        const isContact = !!m.message.contactMessage ||
          !!m.message.contactsArrayMessage ||
          !!m.message.contactMessageV2;

        const isSticker = !!m.message.stickerMessage;
        const isImage = !!m.message.imageMessage;
        const isOnlySticker = isSticker && !text;
        const isOnlyImage = isImage && !text;

        if (isGroup && from !== CONTROL_GROUP) {
          oldMembersCache.add(senderNum);
        }

        if (isOnlySticker || isOnlyImage) {
          continue;
        }

        if (m.key.fromMe) {
          let t = text.trim();
          if (
            t.indexOf('✅') === 0 ||
            t.indexOf('🚫') === 0 ||
            t.indexOf('🤍') === 0 ||
            t.indexOf('🔒') === 0 ||
            t.indexOf('🔗') === 0 ||
            t.indexOf('╭') === 0 ||
            t.indexOf('⚠️') === 0 ||
            t.indexOf('🧹') === 0 ||
            t.indexOf('📌') === 0 ||
            t.indexOf('🚨') === 0 ||
            t.indexOf('☠️') === 0 ||
            t.indexOf('🏰') === 0 ||
            t.indexOf('🔍') === 0 ||
            t.indexOf('•───') === 0 ||
            t.indexOf('⚡') === 0 ||
            t.indexOf('🔇') === 0 ||
            t.indexOf('🔊') === 0 ||
            t.indexOf('🤖') === 0
          ) {
            continue;
          }
        }

        const isOwnerSender = isOwner(senderNum) || isOwner(senderLid) || m.key.fromMe;
        const isWhiteSender = isWhite(senderNum) || isWhite(senderLid) || (lidMap[senderLid] && isWhite(lidMap[senderLid]));
        const isBlackSender = isBlack(senderNum) || isBlack(senderLid);
        const isMutedSender = isMuted(senderNum) || isMuted(senderLid) || (lidMap[senderLid] && isMuted(lidMap[senderLid]));
        const lower = text.toLowerCase().trim().replace(/_/g,' ');

        if (isGroup && trapActive[from] && !isOwnerSender && !m.key.fromMe) {
          let trap = trapActive[from];
          if (Date.now() - trap.time < 60000) {
            if (BOT_COMMANDS.some(c => lower.includes(c))) {
              pendingBotConfirm[senderNum] = {
                jid: from,
                senderJid: sender,
                score: 100,
                reasons: 'رد على الفخ',
                time: Date.now()
              };
              notifyOwner('🪤 وقع في الفخ: ' + senderNum + ' في ' + from + '\nالنسبة: 100% - رد على أمر وهمي ما يردش عليه بنادم\nشن بعت: ' + text.slice(0,50) + '\nاكتب .تأكيد ' + senderNum + ' باش نطرده');
              trapActive[from] = null;
            }
          }
        }

        let botErrorPhrases = [
          'i need to be an admin',
          'need to be an admin',
          'i need admin',
          'bot is not admin',
          'failed to delete',
          'cannot delete'
        ];
        let isBotError = botErrorPhrases.some(ph => lower.includes(ph));

        if (isBotError && isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender) {
          if (knownBots.indexOf(senderNum) === -1) {
            knownBots.push(senderNum);
            saveLists();
          }
          notifyOwner('🤖 كشفت يوزر بوت من غلطته في ' + from + '\nالرقم: ' + senderNum + '\nشن قال: ' + text.slice(0,100) + '\nضفته للقايمة تلقائيا');
          try {
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
          } catch(e) {}
          if (blackList.indexOf(senderNum) === -1) {
            blackList.push(senderNum);
            saveLists();
          }
          continue;
        }

        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender) {
          let joinedRecently = joinWatch[senderNum] && (Date.now() - joinWatch[senderNum] < 2 * 60 * 1000);
          let isBotCmd = BOT_COMMANDS.some(c => lower.startsWith(c) || lower.includes(c));

          if (joinedRecently && isBotCmd) {
            let calc = await calcBotPercent({ id: sender, phoneNumber: senderPn }, text, m.key.id);
            if (calc.strong) {
              if (knownBots.indexOf(senderNum) === -1) {
                knownBots.push(senderNum);
                saveLists();
              }
              if (blackList.indexOf(senderNum) === -1) {
                blackList.push(senderNum);
                saveLists();
              }
              tripleStrike(from, m, sender);
              notifyOwner('🤖 كشفت يوزر بوت أول ما خش في ' + from + '\nالرقم: ' + senderNum + '\nالسبب: خش وبعت أمر بوت طول: ' + text.slice(0,50) + '\nالنسبة: ' + calc.percent + '%');
            } else {
              pendingBotConfirm[senderNum] = {
                jid: from,
                senderJid: sender,
                score: calc.percent,
                reasons: calc.reasons.join(' + '),
                time: Date.now()
              };
              notifyOwner('⚠️ شاك فيه بوت: ' + senderNum + ' في ' + from + '\nالنسبة: ' + calc.percent + '%\nالسبب: ' + calc.reasons.join(' + ') + '\nما طردتاش، اكتب .تأكيد ' + senderNum);
            }
            continue;
          }

          if (isBotCmd) {
            let sc = addBotScoreV2(senderNum, 25, 'أمر بوت');
            if (sc >= 90) {
              if (knownBots.indexOf(senderNum) === -1) {
                knownBots.push(senderNum);
                saveLists();
              }
              tripleStrike(from, m, sender);
              notifyOwner('🤖 كشفت يوزر بوت من أوامره في ' + from + '\nالرقم: ' + senderNum + '\nبعت: ' + text.slice(0,50));
              continue;
            }
            if (sc >= 40) {
              pendingBotConfirm[senderNum] = {
                jid: from,
                senderJid: sender,
                score: sc,
                reasons: 'أوامر بوت متكررة',
                time: Date.now()
              };
              notifyOwner('⚠️ شاك فيه بوت: ' + senderNum + ' في ' + from + '\nالنسبة: ' + sc + '% - أوامر متكررة\nما طردتاش، اكتب .تأكيد ' + senderNum);
              continue;
            }
          }
        }

        const isExemptGroup = isGroup && isExempt(from) && from !== CONTROL_GROUP;
        if (isExemptGroup) {
          let allowOwnerExemptCmd = isOwnerSender && (
            lower.includes('.الغاء استثناء') ||
            lower.includes('.الغاء الاستثناء') ||
            lower === '.استثناءات' ||
            lower === '.قائمة استثناء' ||
            lower === '.ping' ||
            lower === '.سرعة' ||
            lower === '.سرعه'
          );
          if (!allowOwnerExemptCmd) {
            continue;
          }
        }

        if (isGroup && from !== CONTROL_GROUP && isMutedSender && !isOwnerSender && !isWhiteSender) {
          fastDelete(from, m.key);
          continue;
        }

        if (isOwnerSender && (lower === '.سرعة' || lower === '.سرعه' || lower === '.speed')) {
          let sentTime = m.messageTimestamp ? m.messageTimestamp * 1000 : Date.now();
          let latency = Date.now() - sentTime;
          let verdict = latency < 400 ? '✅ ممتاز - أسرع من أغلب بوتات المبندين' : latency < 800 ? '🟡 متوسط' : '🔴 بطيء - السيرفر راقد، دير UptimeRobot';
          await sock.sendMessage(from, { text: '⚡ سرعة البوت: ' + (latency / 1000).toFixed(2) + ' ثانية\n📩 وصول الرسالة: ' + latency + 'ms\n\n' + verdict + '\n\nv11.2 اسرع + ايموجيات' });
          continue;
        }

        if (isOwnerSender && lower === '.ping') {
          await sock.sendMessage(from, { text: '✅ Bot online - ⚡ v11.2 اسرع + ايموجيات - استقبال: ' + (ACCEPT_MODE ? 'ON ✅' : 'OFF') + ' - حماية جهاز: ' + (ANTI_LINKED ? 'ON 🤖' : 'OFF') + (isExemptGroup ? ' - هادا القروب مستثنى' : '') });
          continue;
        }

        const _ctxEarly = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null;
        const _quotedParticipantEarly = _ctxEarly ? (_ctxEarly.participantPn || _ctxEarly.participant) : null;
        const _quotedKeyEarly = (_ctxEarly && _ctxEarly.stanzaId) ? { remoteJid: from, id: _ctxEarly.stanzaId, participant: _quotedParticipantEarly, fromMe: false } : null;

        if (isOwnerSender && isGroup && lower === '.حذف' && _quotedKeyEarly) {
          fastDelete(from, _quotedKeyEarly);
          fastDelete(from, m.key);
          if (from !== CONTROL_GROUP) {
            sock.sendMessage(CONTROL_GROUP, { text: '✅ تم الحذف فوري في قروب ' + (groupNameCache[from] || from) }).catch(()=>{});
          }
          continue;
        }

        if (isGroup && from !== CONTROL_GROUP && isContact && !isOwnerSender && !isWhiteSender) {
          lockGroupForContact(from);
          fastDelete(from, m.key);
          if (!canActOnUser('contact-fast-' + senderNum)) {
            continue;
          }
          fastKick(from, sender);
          if (blackList.indexOf(senderNum) === -1) {
            blackList.push(senderNum);
            saveLists();
          }
          if (senderNum !== senderLid && blackList.indexOf(senderLid) === -1) {
            blackList.push(senderLid);
            saveLists();
          }
          let nowC = Date.now();
          contactTimes = contactTimes.filter(t => nowC - t < 60000);
          contactTimes.push(nowC);
          if (contactTimes.length >= 2) {
            notifyOwner('🚨 جهتين اتصال في دقيقة - سكرت');
            contactTimes = [];
          } else {
            notifyOwner('🧹 جهة اتصال من ' + senderNum + ' في قروب ' + from + '\nالسبب: جهة اتصال 🧹\nتم: حذف + قفل 5 دقايق + طرد + بلاك');
          }
          continue;
        }

        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender) {
          if (isMaliciousLink(text, m)) {
            handleMalicious(from, m, sender, senderNum, 'رابط ملغم / تفجير');
            continue;
          }
          if (Date.now() < warModeUntil && isBlackSender) {
            fastDelete(from, m.key);
            continue;
          }
        }

        const isDangerous = lower.trim().startsWith('.') && DANGEROUS_COMMANDS.some(cmd => lower.includes(cmd));
        if (isDangerous && !isOwnerSender) {
          if (blackList.indexOf(senderNum) === -1) {
            blackList.push(senderNum);
            saveLists();
          }
          notifyOwner('🛡️ محاولة استغلال ثغرة من ' + senderNum + '\nشن بعت: ' + getMsgPreview(m, text));
          if (isGroup) {
            tripleStrike(from, m, sender);
          }
          continue;
        }

        const isForward = (m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.isForwarded) ||
          (m.message.imageMessage && m.message.imageMessage.contextInfo && m.message.imageMessage.contextInfo.isForwarded) ||
          (m.message.videoMessage && m.message.videoMessage.contextInfo && m.message.videoMessage.contextInfo.isForwarded) ||
          (m.message.stickerMessage && m.message.stickerMessage.contextInfo && m.message.stickerMessage.contextInfo.isForwarded) ||
          (m.message.documentMessage && m.message.documentMessage.contextInfo && m.message.documentMessage.contextInfo.isForwarded);

        const ctx = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null;
        const quotedParticipant = ctx ? (ctx.participantPn || ctx.participant) : null;
        const quotedKey = (ctx && ctx.stanzaId) ? { remoteJid: from, id: ctx.stanzaId, participant: quotedParticipant, fromMe: false } : null;

        let isAdminSender = false;
        if (isGroup && !isOwnerSender) {
          let cacheKey = from + '-' + senderLid;
          if (adminCache[cacheKey] !== undefined && Date.now() - adminCache[cacheKey].time < 300000) {
            isAdminSender = adminCache[cacheKey].isAdmin;
          } else {
            try {
              let meta = await sock.groupMetadata(from);
              let p = meta.participants.find((x) => getNum(x.id) === senderLid || (x.phoneNumber && getNum(x.phoneNumber) === senderNum));
              if (p && p.admin) {
                isAdminSender = true;
              }
              adminCache[cacheKey] = {
                isAdmin: isAdminSender,
                time: Date.now()
              };
            } catch(e) {}
          }
        }

        if (isAdminSender && isContact) {
          continue;
        }

        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender && !isAdminSender) {
          let speedPoints = checkSpeedBot(senderNum, text);
          if (speedPoints > 0) {
            let totalScore = addBotScoreV2(senderNum, speedPoints, 'سرعة رد مشبوهة');
            if (totalScore >= 90) {
              tripleStrike(from, m, sender);
              if (blackList.indexOf(senderNum) === -1) {
                blackList.push(senderNum);
                saveLists();
              }
              notifyOwner('🤖 كشفت يوزر بوت بالسرعة في ' + from + '\nالرقم: ' + senderNum + '\nالنقاط: ' + totalScore + '%\nشن بعت: ' + getMsgPreview(m, text));
              botScoreMap[senderNum] = [];
              continue;
            }
            if (totalScore >= 40) {
              pendingBotConfirm[senderNum] = {
                jid: from,
                senderJid: sender,
                score: totalScore,
                reasons: 'سرعة مشبوهة',
                time: Date.now()
              };
              notifyOwner('⚠️ شاك فيه بوت بالسرعة: ' + senderNum + ' في ' + from + '\nالنسبة: ' + totalScore + '%\nما طردتاش، اكتب .تأكيد ' + senderNum);
              botScoreMap[senderNum] = [];
              continue;
            }
          }
        }

        if (isOwnerSender) {
          let isSensitiveCmd = lower.includes('.حظر') || lower.includes('.ابيض') || lower.includes('.طرد') || lower.includes('.فحص') || lower.includes('.تنظيف') || lower.includes('.تشخيص') || lower.includes('.ادوات') || lower.includes('.بيضاء') || lower.includes('.بلاك') || lower.includes('.قائمة') || lower.includes('.حذف') || lower.includes('.استقبال') || lower.includes('.قبول') || lower.includes('.تم القبول') || lower.includes('.سكر الاستقبال') || lower.includes('.قسيمة') || lower.includes('.قفل الروابط') || lower.includes('.فتح الروابط') || lower.includes('.فك حظر') || lower.includes('.الغاء') || lower.includes('.استثناء') || lower.includes('.سرعة') || lower.includes('.سرعه') || lower.includes('.كتم') || lower.includes('.فك كتم') || lower.includes('.داتا') || lower.includes('.بوت') || lower.includes('.كشف') || lower.includes('.تأكيد') || lower.includes('.فخ') || lower.includes('.بصمة');

          if (isSensitiveCmd && from !== CONTROL_GROUP) {
            hideOwnerCommand(from, m);
          }

          let r = async (txt) => {
            if (isSensitiveCmd && from !== CONTROL_GROUP) {
              await replyControl(txt);
            } else {
              await reply(from, txt);
            }
          };

          if (lower === '.ايدي') {
            await reply(from, 'ID متع القروب:\n' + from);
            continue;
          }

          if (lower.startsWith('.تأكيد') || lower.startsWith('.تاكيد') || lower === '.اكد') {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) {
              let keys = Object.keys(pendingBotConfirm);
              if (!keys.length) {
                await r('⚠️ مافيش حد مستني تأكيد');
                continue;
              }
              await r('⚠️ شاك فيهم، رد عليهم ولا اكتب رقمهم + .تأكيد:\n' + keys.map(k => k + ' - ' + pendingBotConfirm[k].score + '% - ' + pendingBotConfirm[k].reasons).join('\n'));
              continue;
            }
            for (let n of expanded) {
              let pend = pendingBotConfirm[n];
              if (!pend) {
                await r('⚠️ ' + n + ' مش في قايمة التأكيد، دير .بصمة عليه الأول');
                continue;
              }
              let targetJid = pend.senderJid;
              let ok = false;
              try {
                ok = await kickAndRename(pend.jid, targetJid, 'تأكيد بوت');
              } catch(e) {}
              if (!ok) {
                try {
                  let meta2 = await sock.groupMetadata(pend.jid);
                  let pp = meta2.participants.find(x => getNum(x.id) === n || (x.phoneNumber && getNum(x.phoneNumber) === n));
                  if (pp) {
                    ok = await kickAndRename(pend.jid, pp.id, 'تأكيد بوت');
                  }
                } catch(e) {}
              }
              if (ok) {
                if (blackList.indexOf(n) === -1) blackList.push(n);
                if (knownBots.indexOf(n) === -1) knownBots.push(n);
                saveLists();
                delete pendingBotConfirm[n];
                await r('✅ أكدت وطردت ' + n + ' - كان ' + pend.score + '% بوت');
              } else {
                await r('❌ فشل الطرد - تأكد ان البوت أدمن في ' + pend.jid);
              }
            }
            continue;
          }

          if (lower.startsWith('.تجاهل') || lower.startsWith('.تجاهل بوت') || lower.includes('.مش بوت')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            for (let n of expanded) {
              delete pendingBotConfirm[n];
              if (whiteList.indexOf(n) === -1) whiteList.push(n);
            }
            saveLists();
            await r('✅ تجاهلته وضفته للبيضاء، معاش حنشك فيه:\n' + expanded.join('\n'));
            continue;
          }

          if (lower === '.فخ' || lower === '.فخ بوت' || lower === '.trap') {
            if (!isGroup) {
              await r('⚠️ الفخ يخدم في القروب بس');
              continue;
            }
            let trapText = '.فحص_وهمي_' + Math.floor(Math.random() * 9999);
            trapActive[from] = {
              time: Date.now(),
              trapText
            };
            await sock.sendMessage(from, { text: trapText });
            await r('🪤 حطيت فخ: ' + trapText + '\nالبنادم ما يردش عليه، البوت يرد طول');
            continue;
          }

          if (lower === '.كشف' || lower.includes('.كشف بوت')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) {
              await r('⚠️ رد على رسالته واكتب .كشف');
              continue;
            }
            let n = expanded[0];
            let score = getBotScoreV2(n);
            let inList = knownBots.includes(n);
            let joined = joinWatch[n] ? Math.floor((Date.now() - joinWatch[n]) / 1000) + ' ثانية فاتت' : 'قديم في القروب';
            await r('🔍 كشف ' + n + ':\n🤖 في قايمة البوتات: ' + (inList ? 'ايه ✅ بوت' : 'لا ❌') + '\n⚡ نقاط السرعة: ' + score + '%\n🕒 خش من: ' + joined);
            continue;
          }

          if (lower === '.فحص عميق' || lower === '.فحص قوي' || lower === '.ديب') {
            if (!isGroup) {
              await r('⚠️ الفحص العميق يخدم في القروب بس');
              continue;
            }
            try {
              let meta = await sock.groupMetadata(from);
              let out = [];
              let kicked = [];
              let needConfirm = [];
              for (let p of meta.participants) {
                let nn = getParticipantNum(p);
                if (isMe(p) || isWhiteParticipant(p) || isOwner(nn)) {
                  continue;
                }
                if (p.admin) {
                  continue;
                }
                let d = await deepCheckUser(p, from);
                if (d.isBot) {
                  out.push(nn + ' - ' + d.score + '% - ' + d.reason);
                  let ok = await kickAndRename(from, p.id, 'فحص عميق');
                  if (ok) {
                    kicked.push(nn);
                    if (blackList.indexOf(nn) === -1) blackList.push(nn);
                    if (knownBots.indexOf(nn) === -1) knownBots.push(nn);
                  }
                } else if (d.needsConfirm) {
                  needConfirm.push(nn + ' - ' + d.score + '%');
                  pendingBotConfirm[nn] = {
                    jid: from,
                    senderJid: p.id,
                    score: d.score,
                    reasons: d.reason,
                    time: Date.now()
                  };
                }
              }
              saveLists();
              await r('🔍 فحص عميق v11.2 كمل:\nلقيت ' + out.length + ' بوت مؤكد، طردت ' + kicked.length + '\nشاك فيهم ' + needConfirm.length + '، ما طردتهمش، اكتب .تأكيد + رقمهم\n\n' + (out.length ? out.join('\n') : 'مافيش بوتات مؤكدة') + '\n\n⚠️ شاك فيهم:\n' + (needConfirm.length ? needConfirm.join('\n') : 'مافيش'));
            } catch(e) {
              await r('خطأ فحص عميق: ' + e.message);
            }
            continue;
          }

          if (lower === '.قائمة بوتات' || lower === '.بوتات' || lower === '.قايمة بوتات') {
            await r('🤖 قايمة البوتات اليدوية:\n' + (knownBots.length ? knownBots.join('\n') : 'فاضية'));
            continue;
          }

          if (lower.includes('.بوت اضافة') || lower.includes('.بوت اضافه') || lower.includes('.اضافة بوت') || lower.includes('.اضافه بوت')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) {
              await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .بوت اضافة');
              continue;
            }
            for (let n of expanded) {
              if (knownBots.indexOf(n) === -1) knownBots.push(n);
            }
            saveLists();
            await r('🤖 ضفت للبوتات:\n' + expanded.join('\n'));
            continue;
          }

          if (lower.includes('.بوت حذف') || lower.includes('.بوت الغاء') || lower.includes('.حذف بوت')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            for (let n of expanded) {
              knownBots = knownBots.filter(x => x !== n);
            }
            saveLists();
            await r('✅ نحيت من البوتات:\n' + expanded.join('\n'));
            continue;
          }

          if (lower === '.داتا') {
            try {
              if (!isGroup) {
                await r('⚠️ .داتا يخدم في القروب بس');
                continue;
              }
              let meta = await sock.groupMetadata(from);
              let target = null;
              if (quotedParticipant) {
                target = meta.participants.find(x => getNum(x.id) === getNum(quotedParticipant) || (x.phoneNumber && getNum(x.phoneNumber) === getNum(quotedParticipant)));
              } else if (ctx && ctx.mentionedJid && ctx.mentionedJid.length) {
                target = meta.participants.find(x => getNum(x.id) === getNum(ctx.mentionedJid[0]));
              } else {
                let nums = getTargets(text, ctx, quotedParticipant);
                if (nums.length) {
                  target = meta.participants.find(x => getNum(x.id) === nums[0] || (x.phoneNumber && getNum(x.phoneNumber) === nums[0]));
                }
              }
              if (!target) {
                await r('⚠️ رد على رسالة الشخص واكتب .داتا');
                continue;
              }
              await r('DATA:\n' + JSON.stringify(target, null, 2).slice(0, 3000));
              try {
                let biz = await sock.getBusinessProfile(target.id);
                await r('BIZ:\n' + JSON.stringify(biz, null, 2).slice(0, 2000));
              } catch(e) {
                await r('BIZ ERROR: ' + e.message);
              }
              let rev = await revealPhone(target, ctx, quotedParticipant);
              let tNum = rev.phone;
              let tLid = rev.lid;
              let myGroups = [];
              try {
                const allGroups = await sock.groupFetchAllParticipating();
                for (let gjid in allGroups) {
                  let gMeta = allGroups[gjid];
                  let found = gMeta.participants.find(x => {
                    let xn = getNum(x.id);
                    let xp = x.phoneNumber ? getNum(x.phoneNumber) : '';
                    return xn === tNum || xn === tLid || xp === tNum || xp === tLid || (lidMap[xn] && (lidMap[xn] === tNum || lidMap[xn] === tLid));
                  });
                  if (found) {
                    let isAdminIn = found.admin ? ' 👑 أدمن' : '';
                    myGroups.push('• ' + (gMeta.subject || gjid) + isAdminIn);
                  }
                }
              } catch(e) {}
              await r('📱 الرقم الحقيقي: ' + (rev.hidden ? 'مخفي - واتساب حاجبه' : rev.phone) + '\n🆔 LID: ' + tLid + '\n📍 داخل مع البوت في ' + myGroups.length + ' قروب:\n' + (myGroups.length ? myGroups.join('\n') : 'مافيش - غير هادا'));
            } catch(e) {
              await r('داتا خطأ: ' + e.message);
            }
            continue;
          }

          if (lower === '.بصمة' || lower === '.فينجر' || lower === '.fingerprint') {
            if (!isGroup) {
              await r('⚠️ .بصمة يخدم في قروبه فقط');
              continue;
            }
            if (!ctx || !ctx.stanzaId) {
              await r('⚠️ رد على رسالة المشبوه في قروبه واكتب .بصمة');
              continue;
            }
            let qId = ctx.stanzaId || '';
            let qNum = quotedParticipant ? getNum(quotedParticipant) : '';
            let qPhone = quotedParticipant && ctx.participantPn ? getNum(ctx.participantPn) : qNum;
            let realQ = qPhone || lidMap[qNum] || qNum;
            let qText = (ctx.quotedMessage?.conversation || ctx.quotedMessage?.extendedTextMessage?.text || ctx.quotedMessage?.imageMessage?.caption || ctx.quotedMessage?.videoMessage?.caption || '').toLowerCase();
            let calc = await calcBotPercent({ id: quotedParticipant, phoneNumber: ctx.participantPn, notify: '', name: '' }, qText, qId);
            let rev2 = null;
            try {
              let meta2 = await sock.groupMetadata(from);
              let tgt2 = meta2.participants.find(x => getNum(x.id) === qNum || (x.phoneNumber && getNum(x.phoneNumber) === qNum));
              if (tgt2) {
                rev2 = await revealPhone(tgt2, ctx, quotedParticipant);
              }
            } catch(e) {}
            let showNum = rev2 ? (rev2.hidden ? 'مخفي' : rev2.phone) : realQ;
            let verdict = '';
            let action = '';
            let groupNote = '📍 الفحص في قروبه: ' + (groupNameCache[from] || from);
            if (calc.percent >= 90) {
              verdict = '🤖 بوت ✅\nالنسبة: ' + calc.percent + '%';
              action = '\n\nاكتب .تأكيد ' + realQ + ' باش نطرده من قروبه';
            } else if (calc.percent >= 40) {
              verdict = '⚠️ شاك فيه\nالنسبة: ' + calc.percent + '%';
              action = '\n\nما طردتاش\nاكتب .تأكيد ' + realQ + ' باش نطرده، ولا .تجاهل ' + realQ + ' باش نخليه';
              pendingBotConfirm[realQ] = {
                jid: from,
                senderJid: quotedParticipant,
                score: calc.percent,
                reasons: calc.reasons.join(' + '),
                time: Date.now()
              };
            } else {
              verdict = '👤 مو بوت ❌ بنادم\nالنسبة: ' + calc.percent + '%';
              action = '\n\nهذا عضو عادي';
            }
            await r('🔍 بصمة ' + showNum + ':\n' + verdict + '\n🆔 LID: ' + qNum + '\n\nالأسباب: ' + (calc.reasons.length ? calc.reasons.join(' + ') : 'مافيش') + '\nID: ' + qId + '\n' + groupNote + action);
            continue;
          }

          if (lower === '.قسيمة' || lower === '.قسيمه' || lower === '.تجربة قسيمة') {
            await sendSessionReport(from, '999999999@test', false);
            await r('✅ بعت قسيمة تجريبية، شوف قروب التحكم');
            continue;
          }

          if (lower === '.حماية بوت' || lower === '.حماية جهاز' || lower === '.جهاز مرتبط') {
            await r('🤖 حماية جهاز مرتبط: ' + (ANTI_LINKED ? 'شغالة ON' : 'طافية OFF') + '\n.حماية بوت تشغيل\n.حماية بوت اطفاء');
            continue;
          }

          if (lower === '.حماية بوت تشغيل' || lower === '.تشغيل حماية بوت' || lower === '.قفل جهاز مرتبط') {
            ANTI_LINKED = true;
            saveLists();
            await r('🤖 شغلت حماية جهاز مرتبط - أي بوت يخش حينطرد طول');
            continue;
          }

          if (lower === '.حماية بوت اطفاء' || lower === '.اطفاء حماية بوت' || lower === '.فتح جهاز مرتبط') {
            ANTI_LINKED = false;
            saveLists();
            await r('🤖 طفيت حماية جهاز مرتبط');
            continue;
          }

          if (lower === '.كتم' || lower === '.كتم.' || lower === '.mute') {
            await r('❌ استخدم:\n.كتم @منشن أو بالرد\n.كتم الغاء @منشن\n.كتم حالة');
            continue;
          }

          if (lower.includes('.كتم') && !lower.includes('الغاء') && !lower.includes('فك') && !lower.includes('حالة') && !lower.includes('قائمة')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) {
              await r('❌ استخدم:\n.كتم @منشن أو بالرد\n.كتم الغاء @منشن\n.كتم حالة');
              continue;
            }
            let done = [];
            for (let n of expanded) {
              if (isOwner(n)) {
                await r('⛔ ما تقدرش تكتم نفسك');
                continue;
              }
              if (isWhite(n)) {
                await r('🤍 تعذر، لأنه في البيضاء');
                continue;
              }
              if (mutedList.indexOf(n) === -1) {
                mutedList.push(n);
              }
              done.push(n);
            }
            if (done.length) {
              saveLists();
              await r('🔇 تم كتم:\n' + done.join('\n'));
              notifyOwner('🔇 كتمت ' + done.join(', ') + ' في ' + from);
            }
            continue;
          }

          if (lower.includes('.كتم') && (lower.includes('الغاء') || lower.includes('فك'))) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) {
              await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .كتم الغاء');
              continue;
            }
            for (let n of expanded) {
              mutedList = mutedList.filter(x => x !== n);
            }
            saveLists();
            await r('🔊 تم الغاء كتم:\n' + expanded.join('\n'));
            continue;
          }

          if (lower === '.كتم حالة' || lower === '.كتم قائمة' || lower === '.قائمة كتم' || lower === '.المكتومين') {
            await r('🔇 قائمة الكتم:\n' + (mutedList.length ? mutedList.join('\n') : 'فاضية'));
            continue;
          }

          if (lower === '.حذف كتم' || lower === '.حذف الكتم') {
            mutedList = [];
            saveLists();
            await r('✅ مسحت قائمة الكتم كلها');
            continue;
          }

          if (lower === '.استثناء') {
            if (!isGroup) {
              await r('⚠️ الاستثناء يخدم في القروب بس');
              continue;
            }
            if (from === CONTROL_GROUP) {
              await r('⛔ ما تقدرش تستثني قروب التحكم');
              continue;
            }
            if (!isExempt(from)) {
              exemptGroups.push(from);
              saveLists();
            }
            await r('✅ تم استثناء هادا القروب - معاش حيلمسه\nللإلغاء اكتب: .الغاء استثناء');
            await notifyOwner('✅ استثنيت قروب ' + (groupNameCache[from] || from) + '\nID: ' + from);
            continue;
          }

          if (lower === '.الغاء استثناء' || lower === '.الغاء الاستثناء' || lower === '.فك استثناء' || lower === '.إلغاء استثناء') {
            if (!isGroup) {
              await r('⚠️ الغاء الاستثناء يخدم في القروب بس');
              continue;
            }
            exemptGroups = exemptGroups.filter(x => x !== from);
            saveLists();
            await r('✅ لغيت استثناء هادا القروب');
            continue;
          }

          if (lower === '.استثناءات' || lower === '.قائمة استثناء' || lower === '.قايمة استثناء') {
            let list = exemptGroups.length ? exemptGroups.map(j => (groupNameCache[j] || j) + '\n' + j).join('\n\n') : 'فاضية';
            await r('🛡️ القروبات المستثناة:\n' + list);
            continue;
          }

          if (lower === '.استقبال' || lower === '.قبول' || lower === '.استقبال شغال') {
            ACCEPT_MODE = true;
            clearTimeout(acceptTimer);
            acceptTimer = setTimeout(() => {
              ACCEPT_MODE = false;
              notifyOwner('✅ انتهى وضع الاستقبال - رجعت الحماية');
            }, 15 * 60 * 1000);
            await r('✅ وضع الاستقبال شغال 15 دقيقة');
            continue;
          }

          if (lower === '.تم القبول' || lower === '.سكر الاستقبال' || lower === '.خلاص استقبال' || lower === '.انهاء الاستقبال') {
            ACCEPT_MODE = false;
            clearTimeout(acceptTimer);
            await r('✅ سكرت الاستقبال - رجعت الحماية');
            continue;
          }

          if (lower === '.فحص الكل' || lower === '.فحص كل' || lower === '.تنظيف الكل' || lower === '.تنظيف') {
            if (!isGroup) {
              await r('⚠️ الفحص يخدم في القروب بس');
              continue;
            }
            try {
              let meta = await sock.groupMetadata(from);
              let me = null;
              for (let p of meta.participants) {
                if (isMe(p)) me = p;
              }
              let iAmAdmin = me && me.admin;
              if (!iAmAdmin) {
                await r('⚠️ البوت مش أدمن هنا');
                continue;
              }
              let linkedList = [];
              let adminList = [];
              let superAdminList = [];
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (isMe(p)) continue;
                if (isWhiteParticipant(p)) continue;
                if (isOwner(n)) continue;
                if (isSuperAdmin(p)) {
                  superAdminList.push(n + ' (مولى القروب)');
                  continue;
                }
                if (isBotAccount(p)) {
                  linkedList.push(n + ' (بوت)');
                  if (p.admin) adminList.push(n + ' (أدمن + بوت)');
                  continue;
                }
                if (p.admin) {
                  adminList.push(n);
                  continue;
                }
              }
              let kickedList = [];
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (isMe(p)) continue;
                if (isWhiteParticipant(p)) continue;
                if (isOwner(n)) continue;
                if (p.admin) continue;
                if (isBotAccount(p)) {
                  let ok = await kickAndRename(from, p.id, 'فحص الكل');
                  if (ok) {
                    kickedList.push(n);
                    if (blackList.indexOf(n) === -1) blackList.push(n);
                  }
                }
              }
              saveLists();
              await r('🏰 فحص الكل كمل في ' + from + ':\n👥 فحصت: ' + meta.participants.length + '\n🤖 بوت: ' + linkedList.length + '\n🛡️ أدمن: ' + adminList.length + '\n👑 مولى القروب: ' + superAdminList.length + '\n✅ طردت: ' + kickedList.length);
            } catch(e) {
              await r('خطأ فحص الكل: ' + e.message);
            }
            continue;
          }

          if (lower === '.فحص' || lower === '.فحص مشبوهين' || lower === '.فحص بوتات' || lower === '.عد' || lower === '.كم') {
            if (!isGroup) {
              await r('⚠️ الفحص يخدم في القروب بس');
              continue;
            }
            try {
              let meta = await sock.groupMetadata(from);
              let me = null;
              for (let p of meta.participants) {
                if (isMe(p)) me = p;
              }
              let iAmAdmin = me && me.admin;
              let linkedList = [];
              let adminList = [];
              let superAdminList = [];
              let suspectList = [];
              let total = meta.participants.length;
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (isMe(p)) continue;
                if (isWhiteParticipant(p)) continue;
                if (isOwner(n)) continue;
                if (isSuperAdmin(p)) {
                  superAdminList.push(n);
                  continue;
                }
                let smart = await isBotAccountSmart(p, getBotScoreV2(n));
                if (smart.isBot) {
                  linkedList.push(n + (p.admin ? ' (أدمن + بوت)' : ' (بوت - ' + smart.reason + ')'));
                  if (p.admin) adminList.push(n);
                  continue;
                }
                if (p.admin) {
                  adminList.push(n);
                  continue;
                }
                if (isGlobalBlack(p)) suspectList.push(n);
                else if (getBotScoreV2(n) >= 20) suspectList.push(n + ' (مشبوه - سرعة)');
              }
              if (!iAmAdmin) {
                await r('🔍 فحص - عد بس (البوت مش ادمن هنا) في ' + from + ':\n👥 اجمالي: ' + total + '\n🤖 بوت: ' + linkedList.length + '\n🛡️ أدمن: ' + adminList.length + '\n👑 مولى القروب: ' + superAdminList.length + '\n⚠️ مشبوه: ' + suspectList.length);
                continue;
              }
              let kickedList = [];
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (isMe(p)) continue;
                if (isWhiteParticipant(p)) continue;
                if (isOwner(n)) continue;
                if (p.admin) continue;
                let smart = await isBotAccountSmart(p, getBotScoreV2(n));
                if (smart.isBot) {
                  let ok = await kickAndRename(from, p.id, 'فحص');
                  if (ok) {
                    kickedList.push(n);
                    if (blackList.indexOf(n) === -1) blackList.push(n);
                  }
                }
              }
              saveLists();
              await r('🏰 فحص v11.2 كمل في ' + from + ':\n👥 فحصت: ' + total + '\n🤖 بوت: ' + linkedList.length + '\n🛡️ أدمن: ' + adminList.length + '\n👑 مولى القروب: ' + superAdminList.length + '\n✅ طردت: ' + kickedList.length + '\n\n🤖 بوتات:\n' + (linkedList.length ? linkedList.join('\n') : 'مافيش') + '\n\n✅ طردت:\n' + (kickedList.length ? kickedList.join('\n') : 'مافيش'));
              notifyOwner('🏰 فحص في ' + from + ' - لقيت ' + linkedList.length + ' بوت و ' + adminList.length + ' أدمن و ' + superAdminList.length + ' مولى قروب وطردت ' + kickedList.length);
            } catch(e) {
              await r('خطأ فحص: ' + e.message);
            }
            continue;
          }

          if (lower === '.تشخيص') {
            if (from !== CONTROL_GROUP && isGroup) {
              await r('⚠️ التشخيص في قروب التحكم بس');
              continue;
            }
            try {
              const groups = await sock.groupFetchAllParticipating();
              let total = Object.keys(groups).length;
              let adminList = [];
              for (let jid in groups) {
                const meta = groups[jid];
                let me2 = null;
                for (let p of meta.participants) {
                  if (isMe(p)) me2 = p;
                }
                if (me2 && me2.admin) {
                  adminList.push(meta.subject || jid);
                }
              }
              let msg = '🔍 تشخيص:\nرقمي: ' + OWNER_NUMBER + '\nمجموع القروبات: ' + total + '\nأدمن في: ' + adminList.length + '\nبيضاء: ' + whiteList.length + '\nبلاك عام: ' + blackList.length + '\nمكتومين: ' + mutedList.length + '\nبوتات معروفة: ' + knownBots.length + '\nمستثنى: ' + exemptGroups.length + '\nحماية بوت: ' + (ANTI_LINKED ? 'ON' : 'OFF') + '\nمستني تأكيد: ' + Object.keys(pendingBotConfirm).length;
              await r(msg);
            } catch(e) {
              await r('خطأ تشخيص: ' + e.message);
            }
            continue;
          }

          if (lower === '.ادوات') {
            let menu = '╭─── 🍷 ───╮\n';
            menu += '│ 🤍 البيضاء: ' + whiteList.length + '\n';
            menu += '│ 🚫 البلاك العام: ' + blackList.length + '\n';
            menu += '│ 🔇 المكتومين: ' + mutedList.length + '\n';
            menu += '│ 🤖 بوتات معروفة: ' + knownBots.length + '\n';
            menu += '│ 🛡️ مستثنى: ' + exemptGroups.length + '\n';
            menu += '│ 🔗 الروابط: ' + (lockLinks ? 'مقفولة' : 'مفتوحة') + '\n';
            menu += '│ ⚡ السرعة: v11.2 اسرع + ايموجيات\n';
            menu += '│ 💣 حماية ملغّمة: شغالة\n';
            menu += '│ 🤖 حماية بوت: ' + (ANTI_LINKED ? 'شغالة ON' : 'طافية OFF') + '\n';
            menu += '│ 📥 استقبال: ' + (ACCEPT_MODE ? 'شغال ON ✅' : 'طافي OFF') + '\n';
            menu += '│ ⚠️ مستني تأكيد: ' + Object.keys(pendingBotConfirm).length + '\n';
            menu += '╰─── 🍷 ───╯\n\n';
            menu += '⚙️ اوامر ⚙️\n';
            menu += '• .ايدي\n• .داتا\n• .بصمة\n• .تشخيص\n• .قسيمة\n• .سرعة\n• .كشف\n• .فحص عميق\n• .تأكيد + رقم / .تجاهل + رقم\n• .فخ\n• .حماية بوت\n• .استقبال / .تم القبول\n• .استثناء / .الغاء استثناء / .استثناءات\n• .فحص / .فحص الكل\n• .قائمة بوتات\n• رد + .ابيض / .حظر / .طرد / .فك حظر / .كتم\n• .حظر جماعي\n• .بيضاء / .بلاك / .قائمة\n• .حذف\n• .فتح / .سكر\n• .قفل الروابط / .فتح الروابط\n• .معلومات\n• .ping';
            await r(menu);
            continue;
          }

          if (lower === '.معلومات' && isGroup) {
            let meta = await sock.groupMetadata(from);
            let admins = meta.participants.filter((p) => p.admin).length;
            let info = '╭─── 🍷 ───╮\n│ 📛 القروب: ' + meta.subject + '\n│ 👥 الأعضاء: ' + meta.participants.length + '\n│ 🛡️ المشرفين: ' + admins + '\n│ 🛡️ مستثنى: ' + (isExempt(from) ? 'ايه ✅' : 'لا') + '\n╰─── 🍷 ───╯';
            await reply(from, info);
            continue;
          }

          if (lower === '.بيضاء') {
            await r('🤍 البيضاء:\n' + (whiteList.length ? whiteList.join('\n') : 'فاضية'));
            continue;
          }

          if (lower === '.بلاك') {
            await r('🚫 البلاك العام:\n' + (blackList.length ? blackList.join('\n') : 'فاضي'));
            continue;
          }

          if (lower === '.قائمة') {
            await r('🤍 بيضاء: ' + whiteList.length + '\n🚫 بلاك عام: ' + blackList.length + '\n🔇 مكتومين: ' + mutedList.length + '\n🤖 بوتات معروفة: ' + knownBots.length + '\n🛡️ مستثنى: ' + exemptGroups.length + '\n🤖 حماية بوت: ' + (ANTI_LINKED ? 'ON' : 'OFF') + '\n⚠️ مستني تأكيد: ' + Object.keys(pendingBotConfirm).length);
            continue;
          }

          if (lower === '.فتح' && isGroup) {
            try {
              await sock.groupSettingUpdate(from, 'not_announcement');
              await reply(from, '✅ فتحت القروب');
            } catch(e) {}
            continue;
          }

          if ((lower === '.سكر' || lower === '.قفل') && isGroup) {
            try {
              await sock.groupSettingUpdate(from, 'announcement');
              await reply(from, '🔒 سكرت القروب');
            } catch(e) {}
            continue;
          }

          if (lower === '.قفل الروابط') {
            lockLinks = true;
            saveLists();
            await r('🔗 قفلت الروابط');
            continue;
          }

          if (lower === '.فتح الروابط') {
            lockLinks = false;
            saveLists();
            await r('🔗 فتحت الروابط');
            continue;
          }

          if (lower === '.حذف' && isGroup) {
            if (quotedKey) {
              fastDelete(from, quotedKey);
              notifyOwner('✅ تم الحذف في قروب ' + from);
            } else {
              await r('⚠️ رد على الرسالة اللي تبي تحذفها');
            }
            continue;
          }

          if (lower === '.حذف القوائم' || lower === '.حذف الكل') {
            whiteList = [];
            blackList = [];
            mutedList = [];
            saveLists();
            await r('✅ مسحت البيضاء والبلاك والكتم كلهم');
            continue;
          }

          if (lower === '.حذف ابيض') {
            whiteList = [];
            saveLists();
            await r('✅ مسحت البيضاء كلها');
            continue;
          }

          if (lower === '.حذف بلاك') {
            blackList = [];
            saveLists();
            await r('✅ مسحت البلاك العام كله');
            continue;
          }

          if (lower.includes('.طرد')) {
            if (!isGroup) {
              await r('⚠️ الطرد يخدم في القروب بس');
              continue;
            }
            let targetJid = null;
            if (quotedParticipant) {
              targetJid = quotedParticipant;
            } else if (ctx && ctx.mentionedJid && ctx.mentionedJid.length) {
              targetJid = ctx.mentionedJid[0];
            } else {
              let tgs = getTargets(text, ctx, quotedParticipant);
              if (tgs.length) {
                targetJid = tgs[0] + '@s.whatsapp.net';
              }
            }
            if (!targetJid) {
              await r('⚠️ رد على رسالة الشخص ولا تاقيه ولا ابعث رقمه');
              continue;
            }
            let targetNum = getNum(targetJid);
            if (isWhite(targetNum)) {
              await r('🤍 تعذر، لأنه في القائمة البيضاء');
              continue;
            }
            let candidates = [targetJid];
            if (targetJid.includes('@s.whatsapp.net')) {
              candidates.push(targetNum + '@lid');
            }
            if (targetJid.includes('@lid')) {
              candidates.push(targetNum + '@s.whatsapp.net');
            }
            try {
              let meta = await sock.groupMetadata(from);
              let p = meta.participants.find(x => getNum(x.id) === targetNum || (x.phoneNumber && getNum(x.phoneNumber) === targetNum) || (lidMap[targetNum] && x.phoneNumber && getNum(x.phoneNumber) === lidMap[targetNum]));
              if (p) {
                candidates.unshift(p.id);
              }
            } catch(e) {}
            let ok = false;
            let tried = new Set();
            for (let cand of candidates) {
              if (tried.has(cand)) continue;
              tried.add(cand);
              try {
                ok = await kickAndRename(from, cand, 'طرد يدوي');
              } catch(e) {}
              if (ok) break;
            }
            if (ok) {
              if (blackList.indexOf(targetNum) === -1) {
                blackList.push(targetNum);
                saveLists();
              }
              notifyOwner('🚨 طردت ' + targetNum + ' من قروب ' + from + '\nالسبب: طرد يدوي بأمر المالك');
            } else {
              await r('❌ فشل الطرد - تأكد ان البوت أدمن');
            }
            continue;
          }

          if (lower.includes('.فك حظر') || lower.includes('.الغاء حظر') || lower.includes('.الغاء بلاك')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (expanded.length) {
              for (let n of expanded) {
                blackList = blackList.filter((x) => x !== n);
              }
              saveLists();
              await r('✅ فكيت الحظر العام على ' + expanded.length + ' رقم');
            } else {
              await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه');
            }
            continue;
          }

          if (lower.includes('.الغاء ابيض')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            for (let n of expanded) {
              whiteList = whiteList.filter((x) => x !== n);
            }
            saveLists();
            await r('✅ نحيت ' + expanded.length + ' رقم من البيضاء');
            continue;
          }

          if (lower.includes('.حظر الكل') || lower.includes('.حظر جماعي') || lower.includes('.حظر') || lower.includes('.اضف بلاك')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            let inWhite = expanded.filter((n) => isWhite(n));
            let toBan = expanded.filter((n) => !isWhite(n));
            if (inWhite.length && toBan.length === 0) {
              await r('⛔ تعذر، لأنه في القائمة البيضاء');
              continue;
            }
            if (toBan.length) {
              for (let n of toBan) {
                if (blackList.indexOf(n) === -1) blackList.push(n);
              }
              saveLists();
              await r('🚫 حظرت ' + toBan.length + ' رقم في البلاك العام');
              let k = await kickBlacklistedFromAllGroups();
              if (k > 0) {
                await r('✅ طردت ' + k + ' واحد من كل القروبات');
              } else {
                await r('✅ ما لقيتاش داخل في أي قروب توا، لكن لو حاول يخش حينطرد طول');
              }
              if (toBan.length >= 10) {
                await notifyOwner('🚨 حظر جماعي عام: ' + toBan.length + ' رقم');
              }
            } else {
              await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .حظر');
            }
            continue;
          }

          if (lower.includes('.ابيض')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (expanded.length) {
              let inBlack = expanded.filter((n) => isBlack(n));
              let toAdd = expanded.filter((n) => !isBlack(n));
              if (inBlack.length) {
                await r('⛔ تعذر، لأنه في القائمة السوداء');
                continue;
              }
              for (let n of toAdd) {
                if (whiteList.indexOf(n) === -1) whiteList.push(n);
              }
              saveLists();
              await r('✅ ضفت ' + toAdd.length + ' رقم للبيضاء من قروب ' + from);
            } else {
              await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .ابيض');
            }
            continue;
          }

          continue;
        }

        if (!isGroup) {
          continue;
        }
        if (from === CONTROL_GROUP) {
          continue;
        }
        if (isWhiteSender) {
          continue;
        }
        if (isAdminSender) {
          continue;
        }

        if (RAID_MODE) {
          if (canActOnUser('raid-' + senderNum)) {
            tripleStrike(from, m, sender);
            if (blackList.indexOf(senderNum) === -1) {
              blackList.push(senderNum);
              saveLists();
            }
            notifyOwner('🏰 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: وضع هجوم منسق\nشن بعت: ' + getMsgPreview(m, text));
          }
          continue;
        }

        if (isGroup && !isWhiteSender && !isOwnerSender && !isAdminSender && !isSticker) {
          let score = 0;
          let reason = '';
          if ((joinTimeMap[senderNum] && (Date.now() - joinTimeMap[senderNum] < 3000)) || (joinTimeMap[senderLid] && (Date.now() - joinTimeMap[senderLid] < 3000))) {
            score += 1;
            reason += 'خش وبعت طول، ';
          }
          if (isContact || hasLink(text) || isForward) {
            score += 2;
            reason += 'اول رسالة رابط/جهة/فوروارد، ';
          }
          if (score > 0) {
            let total = addBotScore(senderNum, score);
            if (total >= 3) {
              if (canActOnUser('botdetect-' + senderNum)) {
                tripleStrike(from, m, sender);
                if (blackList.indexOf(senderNum) === -1) {
                  blackList.push(senderNum);
                  saveLists();
                }
                notifyOwner('🤖 كشفت بوت في قروب ' + from + '\nالرقم: ' + senderNum + '\nالسبب: ' + reason + '\nالنقاط: ' + total + '/3\nشن بعت: ' + getMsgPreview(m, text));
                botScore[senderNum] = [];
              }
              continue;
            }
          }
        }

        if (isBlackSender) {
          if (!canActOnUser('black-' + senderNum)) {
            continue;
          }
          tripleStrike(from, m, sender);
          notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: في البلاك العام\nشن بعت: ' + getMsgPreview(m, text));
          continue;
        }

        if (isForward && !isSticker) {
          if (!canActOnUser('fwd-' + senderNum)) {
            continue;
          }
          tripleStrike(from, m, sender);
          if (!forwardedLocked[from]) {
            forwardedLocked[from] = true;
            notifyOwner('🚨 فوروارد من ' + senderNum + ' في قروب ' + from + ' - سكرت\nشن بعت: ' + getMsgPreview(m, text));
            setTimeout(() => {
              forwardedLocked[from] = false;
            }, 3 * 60 * 1000);
          }
          if (blackList.indexOf(senderNum) === -1) {
            blackList.push(senderNum);
            saveLists();
          }
          continue;
        }

        if (hasLink(text)) {
          if (!canActOnUser('link-' + senderNum)) {
            continue;
          }
          if (lockLinks) {
            tripleStrike(from, m, sender);
            notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: الروابط مقفولة\nشن بعت: ' + getMsgPreview(m, text));
            continue;
          }
          fastDelete(from, m.key);
          linkCount[senderNum] = (linkCount[senderNum] || 0) + 1;
          if (linkCount[senderNum] >= 2) {
            fastKick(from, sender);
            notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: رابط مكرر\nشن بعت: ' + getMsgPreview(m, text));
            linkCount[senderNum] = 0;
          } else {
            fastLock(from);
            setTimeout(() => {
              fastUnlock(from);
            }, 60000);
            notifyOwner('🔒 سكرت القروب ' + from + ' 1 دقيقة\nالسبب: ' + senderNum + ' بعت رابط\nشن بعت: ' + getMsgPreview(m, text));
          }
          continue;
        }

        if (STICKER_SPAM_ENABLED && (isSticker || isImage)) {
          let now = Date.now();
          if (!stickerCount[senderNum]) {
            stickerCount[senderNum] = [];
          }
          stickerCount[senderNum] = stickerCount[senderNum].filter((t) => now - t < 10000);
          stickerCount[senderNum].push(now);
          if (stickerCount[senderNum].length >= 5) {
            if (!canActOnUser('spam-' + senderNum)) {
              stickerCount[senderNum] = [];
              continue;
            }
            tripleStrike(from, m, sender);
            if (blackList.indexOf(senderNum) === -1) {
              blackList.push(senderNum);
              saveLists();
            }
            notifyOwner('🚨 سبام من ' + senderNum + ' في قروب ' + from + ' - بعت 5 ملصقات ورا بعض\nشن بعت: ' + getMsgPreview(m, text));
            stickerCount[senderNum] = [];
            continue;
          }
          continue;
        }

      } catch(e) {
        console.log('Error:', e.message);
      }
    }
  });
}

app.get('/', (req, res) => {
  res.send('Bot Running - v11.2 - Fastest + Emojis');
});

app.get('/qr', async (req, res) => {
  if (req.query.key !== QR_SECRET) {
    return res.send('ممنوع - حط key');
  }
  if (!qrCode) {
    return res.send('No QR - Already connected');
  }
  const img = await qrcode.toDataURL(qrCode);
  res.send('<img src="' + img + '"><h2>Scan QR</h2>');
});

app.get('/keepalive', (req, res) => {
  res.send('alive');
});

setInterval(() => {
  fetch('http://localhost:' + (process.env.PORT || 10000) + '/keepalive').catch(() => {});
}, 4 * 60 * 1000);

app.listen(process.env.PORT || 10000);
startBot();
