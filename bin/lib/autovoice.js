const fs = require('fs');
const fetch = require('node-fetch');
const debug = require('debug')('autovoice:lib');
const RSS = require('rss');

const extractUuid  = require('./extract-uuid');
const parseRSSFeed = require('./parse-rss-feed');
const tts          = require('./get-tts');
const reformat     = require('./reformat');

const SERVER_ROOT   = process.env.SERVER_ROOT;
if (! SERVER_ROOT ) {
	throw new Error('ERROR: SERVER_ROOT not specified in env');
}

/////////////////////////////////////////////////
//------ cache of Audio ItemData structs-------//
const audioItemCache = {}; // mapping fileId to itemData

function storeAudioItemData( itemData ) {
	if( itemData && itemData['fileId'] ) {
		audioItemCache[ itemData['fileId'] ] = itemData;
		return itemData['fileId'];
	} else {
		return null;
	}
}

function retrieveAudioItemData ( fileId ) {
	if (fileId && audioItemCache[fileId] ) {
		return audioItemCache[fileId];
	} else {
		return null;
	}
}
//------eof cache--------

function cdataifyElement(element, text){
	return `<${element}><![CDATA[${text}]]></${element}>`;
}

function constructRSS(rssUrl, items) {

	let lines = [
		`<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">`,
    `<channel>`,
			cdataifyElement('title', 'Automated Voices'),
			cdataifyElement('link', rssUrl),
			cdataifyElement('description', 'A Podcast/RSS feed of automated voices of FT articles, based on an RSS feed of article content'),
			cdataifyElement('generator', 'FT Labs autovoice-podcast'),
			cdataifyElement('docs', 'http://blogs.law.harvard.edu/tech/rss'),
			cdataifyElement('language', 'en'),
			cdataifyElement('pubDate', 'Thu, 01 Jan 1970 00:00:01 +0000'),
			cdataifyElement('lastBuildDate', 'Thu, 01 Jan 1970 00:00:01 +0000'),
	    `<atom:link href="https://example.com/rss.xml" rel="self" type="application/rss+xml"/>`,
	];

	items.forEach(item => {
		if (item) {
			lines = lines.concat([
				`<item>`,
					cdataifyElement('title', item.title),
					cdataifyElement('link', SERVER_ROOT + item.fileId),
					cdataifyElement('description', 'deliberately left blank'),
					cdataifyElement('pubDate', item.pubdate),
					`<guid isPermaLink="true">![CDATA[ ${item.guid} ]]</guid>`,
				`</item>`,
			]);
		}
	});

	lines = lines.concat([
		`</channel>`,
		`</rss>`,
	]);

	return lines.join("\n");
}

function formatContentForReading(itemData) {
	let texts = [
		`This article is narrated by ${itemData['narrator-id']}, as part of an ongoing experiment with artificial voices.`,
		itemData.title
	];

	if (itemData.author) {
		texts.push(`Written by ${itemData.author}`);
	}

	texts.push(itemData.content);

	texts.push(`This article was ${itemData.title}.`);
	if (itemData.author) {
		texts.push(`Written by ${itemData.author}`);
	}

  texts.push(`This article was narrated by ${itemData['narrator-id']}, as part of an ongoing experiment with artificial voices.`);

	return texts.join("\n");
}

function generatePodcast(rssUrl){
	debug('rssUrl=', rssUrl);

	// fetch the full rss feed
	// loop over each item
	// - establish if refers to an article with a valid uuid (return null if not)
	// - invoke the TTS service on the description text
	// - update the cache, mapping fileId to the itemData from the TTS service call
	// - return the item data, including audio url
	// Wait til all the processing is done
	// construct the new rss feed

	return fetch(rssUrl)
		.then(res  => res.text())
		.then(text => parseRSSFeed(text))
		.then(feed => {
			debug('feed=', feed);

			const promises = feed.channel[0].item.map((item, i)=> {
				const guid = item['guid'][0];
				debug('item[', i, '] guid=', guid);

				const uuid = extractUuid( guid );

				if (!uuid) {
					return null;
				} else {
					return Promise.resolve( uuid )
						.then(uuid => {
							debug('item[', i, '] uuid=', uuid);
							if(uuid === undefined){
								return false;
							}

							var itemData = {
								rssUrl  : rssUrl,
								content : item.description[0],
								voiceId : tts.defaultVoiceId,
								title   : item.title[0],
								guid    : guid,
								pubdate : item.pubDate[0], // <-- NB this should be the now time,
						    author  : item.author[0],
								'narrator-id' : tts.defaultVoiceId,
							}

							itemData['contentForReading'] = formatContentForReading( itemData );

							debug('pretending to TTS, title=', item.title[0], ', voiceId=', itemData.voiceId);

							const mp3Buffer = null;

							itemData = Object.assign({}, itemData, {
								duration      : 10, // <-- NB this needs to be calculated
								uuid          : uuid,
								'is-human'    : false,
								format        : 'mp3',
								mp3Buffer     : mp3Buffer
							});

							const fileId = '/audio_file.mp3?' + [
									    'duration=' + itemData.duration,
								   'narrator-id=' + itemData['narrator-id'],
								          'uuid=' + itemData.uuid,
									    'is-human=' + itemData['is-human'],
									      'format=' + itemData.format
								].join('&');

							itemData['fileId'] = fileId;

							return itemData;
						});
					}
				})

			debug('num promises=', promises.length);

			return Promise.all(promises).then(items => {
				debug('in Promise.all');
				const feed = constructRSS(rssUrl, items);
				return feed;
			}, reason => {
				debug('in Promise.all rejecting:', reason)
			});

		})
		.catch(err => {
			debug(err);
		})
		;
	}

function getMp3(fileId){
	const itemData = retrieveAudioItemData[fileId];
	if (itemData) {
			return Promise.resolve(itemData['mp3Buffer']);
	} else {
		return Promise.resolve( "no mp3 content for fileId=" + fileId );
	}
}

module.exports = {
	podcast : generatePodcast,
	mp3     : getMp3
};