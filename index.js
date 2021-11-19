const path = require('path');

const sqlite3 = require('sqlite3');
const kuromoji = require('kuromoji');

/** 日本語 WordNet DB : http://compling.hss.ntu.edu.sg/wnja/data/1.1/wnjpn.db.gz */
const dbFileName = './wnjpn.db';

/** Kuromoji を用意する */
const createKuromoji = () => new Promise((resolve, reject) => kuromoji
  .builder({ dicPath: path.resolve(__dirname, './node_modules/kuromoji/dict') })
  .build((error, tokenizer) => error ? reject(error) : resolve(tokenizer)));

/** sqlite3.Database を Promise 化するクラス */
class Db {
  /**
   * コンストラクタ
   * 
   * @param {string} dbFileName SQLite DB ファイル名
   */
  constructor(dbFileName) {
    /** SQLite DB ファイル名 */
    this.dbFileName = dbFileName;
    /** SQLite DB */
    this.db = new sqlite3.Database(dbFileName);
    
    // 各メソッドを Promise 化したラッパー関数を定義する : https://github.com/mapbox/node-sqlite3/wiki/API
    ['run', 'get', 'all'].forEach(command => this[command] = (sql, ...params) => new Promise((resolve, reject) => {
      if(Array.isArray(params) && params.length === 1) params = params[0];
      this.db[command](sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    }));
  }
}

/** 日本語 WordNet DB から類似ワードを検索する SQL */
const sqlSelectSimilarWords = `
  WITH
    words_senses AS (
      SELECT word.wordid,
             word.lemma,
             sense.synset
      FROM word
      JOIN sense
             ON word.wordid = sense.wordid
    )
  SELECT similars.*
  FROM words_senses similars
  JOIN words_senses sources
         ON similars.synset = sources.synset
  WHERE
    sources.lemma = ?
  ORDER BY
    LENGTH(similars.lemma)
`;

(async () => {
  // 必要なライブラリを生成しておく
  const db = new Db(dbFileName);
  const tokenizer = await createKuromoji();
  
  // 引数で文章を取得する
  const args = process.argv.slice(2);
  if(!args.length) return console.error('引数で文章を入力してください');
  
  // 文章を形態素解析して分割する
  const text = args.join(' ');
  const segments = tokenizer.tokenize(text);
  
  // 圧縮後のテキストを保持する
  let compressedText = '';
  
  // 文節ごとに処理する
  for(let segment of segments) {
    const originalWord = segment.surface_form;  // 文字
    const partOfSpeech = segment.pos;           // 品詞
    
    // 以下の品詞のみ、日本語 WordNet から類語を調べる
    if(['名詞', '形容詞', '副詞', '動詞'].includes(partOfSpeech)) {
      const similarWord = await db.get(sqlSelectSimilarWords, originalWord);
      // 類語がない場合は元の文字を使う
      if(!similarWord) {
        compressedText += originalWord;
        continue;
      }
      
      // 一番類似度が高い類語を使う
      const compressedWord = similarWord.lemma;
      compressedText += compressedWord;
      continue;
    }
    
    // その他の品詞では元の文字を使う
    compressedText += originalWord;
  }
  
  db.db.close();
  
  console.log(`圧縮前 : ${text}`);
  console.log(`圧縮後 : ${compressedText}`);
})();
