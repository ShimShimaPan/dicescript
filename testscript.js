(function() {
    window.diceJSVersion = 11;

    if (window.location.host == 'jsfiddle.net')
        return;
  
    if (window.loadedDiceJS)
        return;

    function RNG(seed) {
        this.state = seed;
    }

    RNG.prototype = {};

    RNG.prototype.step = function() {
        // Compute (this.state * 1103515245) & 0x7fffffff without roundoff error
        // (Fucking javascript...)
        var a = ((this.state * (1103515245 >> 16)) & 0x7fff) << 16;
        var b = this.state * (1103515245 & 0xffff);
        var product = a + b;

        // Now do the rest of the LCG.
        this.state = (product + 12345) & 0x7fffffff;
        return this.state;
    };

    RNG.prototype.next = function(max) {
        var r = this.step();
        var limit = 0x7fffffff - (0x7fffffff + 1) % max;
        while (r > limit) {
            r = this.step();
        }
        return r % max;
    };

    RNG.prototype.roll = function(count, sides) {
        var sum = 0;
        for (var i = 0; i < count; ++i) {
            sum += 1 + this.next(sides);
        }
        return sum;
    };


    function PostInfo(postElt) {
        this.postElt = postElt;
        this.rng = null;
        this.totalDice = 0;
    }

    PostInfo.prototype = {};

    PostInfo.prototype.getRNG = function() {
        if (this.rng === null) {
            var postElt = this.postElt;
            var postInfoElt = postElt.getElementsByClassName('postInfo')[0];

            // Extract the post number.
            var postNumElt = postInfoElt.getElementsByClassName('postNum')[0];
            var postNum = +postNumElt.textContent.split('.')[1];

            // Extract the post time.
            var dateTimeElt = postInfoElt.getElementsByClassName('dateTime')[0];
            var dateTime = +dateTimeElt.getAttribute('data-utc');

            // Create RNG.
            var rng = new RNG(postNum ^ dateTime);
            rng.next(); rng.next(); rng.next();

            this.rng = rng;
        }
        return this.rng;
    };


    // Take a dice specification (such as "1d10 + 2"), roll the dice, and
    // produce a result string.
    function rollDice(diceStr, post) {
        var result = '';
        var sum = 0;
        var numParts = 0;

        var pos = 0;
        var nextSign = 1;

        if (diceStr[0] == '-') {
            pos = 1;
            nextSign = -1;
        }

        while (pos < diceStr.length) {
            var nextPlus = diceStr.indexOf('+', pos);
            var nextMinus = diceStr.indexOf('-', pos);
            if (nextPlus == -1)
                nextPlus = diceStr.length;
            if (nextMinus == -1)
                nextMinus = diceStr.length;

            // Figure out what to roll now, and what sign to use on the next
            // part of the roll.
            var sign = nextSign;
            var nextPos;
            if (nextPlus <= nextMinus) {
                nextPos = nextPlus;
                nextSign = 1;
            } else {
                nextPos = nextMinus;
                nextSign = -1;
            }

            var spec = diceStr.slice(pos, nextPos).trim();
            pos = nextPos + 1;

            // Perform the current roll.
            var parts = spec.split('d');
            var value;
            if (parts.length == 1 &&
                    parts[0] !== "" && !isNaN(parts[0])) {
                value = +parts[0];
            } else if (parts.length == 2 &&
                    parts[0] !== "" && !isNaN(parts[0]) &&
                    parts[1] !== "" && !isNaN(parts[1])) {
                var dice = +parts[0];
                if (post.totalDice + dice > 100) {
                    return "too many dice.";
                }
                post.totalDice += dice;

                value = post.getRNG().roll(dice, +parts[1]);
            } else {
                return "expected XdY or number, but saw '" + spec + "'.";
            }

            // Add to the output string.
            if (result.length > 0)
                result += sign > 0 ? ' + ' : ' - ';
            else if (sign < 0)
                result += '- ';
            result += value;
            sum += sign * value;
            ++numParts;
        }

        if (numParts == 1)
            return '' + sum;
        else
            return result + ' = ' + sum;
    }

    function handleNewPost(postElt) {
        var post = new PostInfo(postElt);
        try {
            handlePostContent(post);
        } catch (e) {
            console.log(e);
        }
        try {
            handlePostEmail(post);
        } catch (e) {
            console.log(e);
        }
    }

    var inlineRollRegex = /\[([0-9d+\- ]*d[0-9d+\- ]*)\]/;
    function handlePostContent(post) {
        var blockquoteElt = post.postElt.getElementsByClassName('postMessage')[0];

        // Skip posts not containing dice rolls
        if (!inlineRollRegex.test(blockquoteElt.textContent))
            return;

        // Merge any split text nodes
        blockquoteElt.normalize();

        var textNodes = document.evaluate('.//text()', blockquoteElt, null, 7, null);
        var count = 0;
        var i = 0;
        var textNode, match;
        // Loop over text nodes
        while ((textNode = textNodes.snapshotItem(i++))) {
            // Repeatedly cut the text node at the first match
            while ((match = inlineRollRegex.exec(textNode.nodeValue))) {
                ++count;
                if (count > 20)
                    return;

                textNode = textNode.splitText(match.index);
                var diceNode = textNode;
                textNode = textNode.splitText(match[0].length);

                var diceResult = rollDice(match[1], post);

                var diceNode2;
                // If the first character is not a number, then this is an error
                // message.
                if (isNaN(diceResult[0])) {
                    diceNode2 = document.createElement('span');
                    diceNode2.style.fontWeight = 'bold';
                    diceNode2.title = diceResult;
                    diceNode2.textContent = '[' + match[1] + ': error]';
                } else {
                    diceNode2 = document.createElement('b');
                    diceNode2.textContent = '[' + match[1] + ': ' + diceResult + ']';
                }
                diceNode.parentNode.replaceChild(diceNode2, diceNode);
            }
        }
    }

    function handlePostEmail(post) {
        var postInfoElt = post.postElt.getElementsByClassName('postInfo')[0];

        // Extract email.
        var emailElts = postInfoElt.getElementsByClassName('useremail');
        if (emailElts.length === 0)
            return;
        var email = emailElts[0].getAttribute('href').split('mailto:')[1];
        // The email might be url-encoded (as 'dice%2B' or 'dice%2b')
        if (email.slice(0,6) == 'dice%2')
            email = decodeURIComponent(email);
        if (email.slice(0,5) != 'dice+')
            return;
        if (console && console.log)
            console.log('saw email: ' + email);
        var dice = email.slice(5);

        // Roll dice.
        var diceResult = rollDice(dice, post);

        // Add new element to the comment.
        var span = document.createElement('span');
        span.setAttribute('style', 'font-weight: bold');
        span.textContent = '[ Rolled ' + dice + ': ' + diceResult + ' ]';

        var blockquote = post.postElt.getElementsByTagName('blockquote')[0];
        blockquote.insertBefore(document.createElement('br'), blockquote.firstChild);
        blockquote.insertBefore(document.createElement('br'), blockquote.firstChild);
        blockquote.insertBefore(span, blockquote.firstChild);
    }

    function watchThread(thread, handler) {
        var posts = thread.getElementsByClassName('postContainer');
        for (var i = 0; i < posts.length; ++i) {
            handler(posts[i]);
        }

        if (window.MutationObserver) {
            var obs = new MutationObserver(function(records) {
                for (var i = 0; i < records.length; ++i) {
                    var record = records[i];
                    for (var j = 0; j < record.addedNodes.length; ++j) {
                        handler(record.addedNodes[j]);
                    }
                }
            });
            obs.observe(thread, {childList: true});
        } else {
            var lastCount = thread.childNodes.length;
            window.setInterval(function() {
                if (thread.childNodes.length > lastCount) {
                    for (var i = lastCount; i < thread.childNodes.length; ++i) {
                        var child = thread.childNodes[i];
                        if (child.getAttribute && child.getAttribute('class').indexOf('postContainer') >= 0)
                            handler(child);
                    }
                }
                lastCount = thread.childNodes.length;
            }, 2000);
        }
    }

    var thread = document.getElementsByClassName('thread')[0];
    watchThread(thread, handleNewPost);

    window.loadedDiceJS = true;
    if (console && console.log)
        console.log('loaded dice.js v' + window.diceJSVersion);
})();