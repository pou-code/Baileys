import { proto } from '../../WAProto/index.js'
import * as Utils from '../Utils/index.js'
import crypto from 'crypto'

export default class imup {
    constructor(utils, waUploadToServer, relayMessageFn) {
        this.utils = utils
        this.relayMessage = relayMessageFn
        this.waUploadToServer = waUploadToServer
    }

    detectType(content) {
        if (content.requestPaymentMessage) return 'PAYMENT'
        if (content.productMessage) return 'PRODUCT'
        if (content.albumMessage) return 'ALBUM'
        if (content.eventMessage) return 'EVENT'
        if (content.pollResultMessage) return 'POLL_RESULT'
        if (content.orderMessage) return 'ORDER'
        if (content.groupStatus) return 'GROUP_STATUS'
        if (content.groupLabel) return 'GROUP_LABEL'
        return null
    }

    async handlePayment(content, quoted) {
        const data = content.requestPaymentMessage
        let notes = {}

        if (data.sticker?.stickerMessage) {
            notes = {
                stickerMessage: {
                   ...data.sticker.stickerMessage,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant || content.sender,
                        quotedMessage: quoted?.message
                    }
                }
            }
        } else if (data.note) {
            notes = {
                extendedTextMessage: {
                    text: data.note,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant || content.sender,
                        quotedMessage: quoted?.message
                    }
                }
            }
        }

        return {
            requestPaymentMessage: proto.Message.RequestPaymentMessage.fromObject({
                expiryTimestamp: data.expiry || 0,
                amount1000: data.amount || 0,
                currencyCodeIso4217: data.currency || "IDR",
                requestFrom: data.from || "0@s.whatsapp.net",
                noteMessage: notes,
                background: data.background?? {
                    id: "DEFAULT",
                    placeholderArgb: 0xFFF0F0F0
                }
            })
        }
    }

    async handleProduct(content, jid, quoted) {
        const {
            title,
            description,
            thumbnail,
            productId,
            retailerId,
            url,
            body = "",
            footer = "",
            buttons = [],
            priceAmount1000 = null,
            currencyCode = "IDR"
        } = content.productMessage

        let productImage

        if (Buffer.isBuffer(thumbnail)) {
            const { imageMessage } = await this.utils.generateWAMessageContent(
                { image: thumbnail },
                { upload: this.waUploadToServer }
            )
            productImage = imageMessage
        } else if (typeof thumbnail === 'object' && thumbnail.url) {
            const { imageMessage } = await this.utils.generateWAMessageContent(
                { image: { url: thumbnail.url } },
                { upload: this.waUploadToServer }
            )
            productImage = imageMessage
        }

        return {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        body: { text: body },
                        footer: { text: footer },
                        header: {
                            title,
                            hasMediaAttachment: true,
                            productMessage: {
                                product: {
                                    productImage,
                                    productId,
                                    title,
                                    description,
                                    currencyCode,
                                    priceAmount1000,
                                    retailerId,
                                    url,
                                    productImageCount: 1
                                },
                                businessOwnerJid: "0@s.whatsapp.net"
                            }
                        },
                        nativeFlowMessage: { buttons }
                    }
                }
            }
        }
    }

    async handleAlbum(content, jid, quoted) {
        const array = content.albumMessage
        const album = await this.utils.generateWAMessageFromContent(jid, {
            messageContextInfo: {
                messageSecret: crypto.randomBytes(32),
            },
            albumMessage: {
                expectedImageCount: array.filter((a) => a.hasOwnProperty("image")).length,
                expectedVideoCount: array.filter((a) => a.hasOwnProperty("video")).length,
            },
        }, {
            userJid: this.utils.generateMessageID().split('@')[0] + '@s.whatsapp.net',
            quoted,
            upload: this.waUploadToServer
        })

        await this.relayMessage(jid, album.message, {
            messageId: album.key.id,
        })

        for (let content of array) {
            const img = await this.utils.generateWAMessage(jid, content, {
                upload: this.waUploadToServer,
            })

            img.message.messageContextInfo = {
                messageSecret: crypto.randomBytes(32),
                messageAssociation: {
                    associationType: 1,
                    parentMessageKey: album.key,
                },
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast",
                forwardingScore: 99999,
                isForwarded: true,
                mentionedJid: [jid],
                starred: true,
                labels: ["Y", "Important"],
                isHighlighted: true,
                businessMessageForwardInfo: {
                    businessOwnerJid: jid,
                },
                dataSharingContext: {
                    showMmDisclosure: true,
                },
            }

            img.message.forwardedNewsletterMessageInfo = {
                newsletterJid: "0@newsletter",
                serverMessageId: 1,
                newsletterName: `WhatsApp`,
                timestamp: new Date().toISOString(),
                senderName: "7-Yuukey",
                contentType: "UPDATE_CARD",
                priority: "high",
                status: "sent",
            }

            img.message.disappearingMode = {
                initiator: 3,
                trigger: 4,
                initiatorDeviceJid: jid,
                initiatedByExternalService: true,
                initiatedByUserDevice: true,
                initiatedBySystem: true,
                initiatedByServer: true,
                initiatedByAdmin: true,
                initiatedByUser: true,
                initiatedByApp: true,
                initiatedByBot: true,
                initiatedByMe: true,
            }

            await this.relayMessage(jid, img.message, {
                messageId: img.key.id,
                quoted: {
                    key: {
                        remoteJid: album.key.remoteJid,
                        id: album.key.id,
                        fromMe: true,
                        participant: this.utils.generateMessageID().split('@')[0] + '@s.whatsapp.net',
                    },
                    message: album.message,
                },
            })
        }
        return album
    }

    async handleEvent(content, jid, quoted) {
        const eventData = content.eventMessage

        const msg = await this.utils.generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2,
                        messageSecret: crypto.randomBytes(32),
                        supportPayload: JSON.stringify({
                            version: 2,
                            is_ai_message: true,
                            should_show_system_message: true,
                            ticket_id: crypto.randomBytes(16).toString('hex')
                        })
                    },
                    eventMessage: {
                        contextInfo: {
                            mentionedJid: [jid],
                            participant: jid,
                            remoteJid: "status@broadcast",
                            forwardedNewsletterMessageInfo: {
                                newsletterName: "PouCode",
                                newsletterJid: "120363421563597486@newsletter",
                                serverMessageId: 1
                            }
                        },
                        isCanceled: eventData.isCanceled || false,
                        name: eventData.name,
                        description: eventData.description,
                        location: eventData.location || {
                            degreesLatitude: 0,
                            degreesLongitude: 0,
                            name: "Location"
                        },
                        joinLink: eventData.joinLink || '',
                        startTime: typeof eventData.startTime === 'string'? parseInt(eventData.startTime) : eventData.startTime || Date.now(),
                        endTime: typeof eventData.endTime === 'string'? parseInt(eventData.endTime) : eventData.endTime || Date.now() + 3600000,
                        extraGuestsAllowed: eventData.extraGuestsAllowed!== false
                    }
                }
            }
        }, { quoted })

        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        })
        return msg
    }

    async handlePollResult(content, jid, quoted) {
        const pollData = content.pollResultMessage
        const msg = await this.utils.generateWAMessageFromContent(jid, {
            pollResultSnapshotMessage: {
                name: pollData.name,
                pollVotes: pollData.pollVotes.map(vote => ({
                    optionName: vote.optionName,
                    optionVoteCount: typeof vote.optionVoteCount === 'number'
                       ? vote.optionVoteCount.toString()
                        : vote.optionVoteCount
                })),
                contextInfo: {
                    isForwarded: true,
                    forwardingScore: 1,
                    forwardedNewsletterMessageInfo: {
                        newsletterName: pollData.newsletter.newsletterName || "120363399602691477@newsletter",
                        newsletterJid: pollData.newsletter.newsletterJid || "Newsletter",
                        serverMessageId: 1000,
                        contentType: "UPDATE"
                    }
                }
            }
        }, {
            userJid: this.utils.generateMessageID().split('@')[0] + '@s.whatsapp.net',
            quoted
        })

        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        })

        return msg
    }

    async handleOrderMessage(content, jid, quoted) {
        const orderData = content.orderMessage

        const Haha = await this.utils.generateWAMessageFromContent(jid, {
            orderMessage: {
                orderId: orderData.orderId || ("POUCODE" + Date.now()),
                thumbnail: orderData.thumbnail || null,
                itemCount: orderData.itemCount || 0,
                status: "ACCEPTED",
                surface: "CATALOG",
                message: orderData.message,
                orderTitle: orderData.orderTitle,
                sellerJid: "0@whatsapp.net",
                token: orderData.token || "POUCODE_EXAMPLE_TOKEN",
                totalAmount1000: orderData.totalAmount1000 || 0,
                totalCurrencyCode: orderData.totalCurrencyCode || "IDR",
                messageVersion: 2
            }
        }, { quoted: quoted })

        await this.relayMessage(jid, Haha.message, {})
        return Haha
    }

    async handleGroupStory(content, jid, quoted) {
        const storyData = content.groupStatus
        let messageContent

        if (storyData.message) {
            messageContent = storyData
        } else {
            if (typeof this.utils?.generateWAMessageContent === "function") {
                messageContent = await this.utils.generateWAMessageContent(storyData, {
                    upload: this.waUploadToServer
                })
            } else {
                messageContent = await Utils.generateWAMessageContent(storyData, {
                    upload: this.waUploadToServer
                })
            }
        }

        let msg = {
            message: {
                groupStatusMessageV2: {
                    message: messageContent.message || messageContent
                }
            }
        }

        return await this.relayMessage(jid, msg.message, {
            messageId: this.utils.generateMessageID()
        })
    }

    async handleGbLabel(content, jid) {
        const x = content.groupLabel
        if (!jid.endsWith('@g.us')) {
            throw new Error('group required!')
        }

        const msg = await this.utils.generateWAMessageFromContent(jid, {
            protocolMessage: {
                type: "GROUP_MEMBER_LABEL_CHANGE",
                memberLabel: {
                    label: x.labelText.slice(0, 30)
                }
            }
        }, {})

        await this.relayMessage(jid, msg.message, {
            additionalNodes: [
                {
                    tag: 'meta',
                    attrs: {
                        tag_reason: 'user_update',
                        appdata: 'member_tag'
                    },
                    content: undefined
                }
            ]
        })
    }
}
